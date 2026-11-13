-- A job queue with one pending row per scope.
--
-- A scope is whatever the app needs looked at one pass at a time (a room, an account, a
-- document). Asking for it to be looked at is idempotent: ten asks in a second are one note
-- saying "this wants looking at", which is a partial unique index on the pending status.
-- Hasura's own on_conflict cannot name a partial index, so enqueueing is a function, and a
-- function is where the rest of the rules live too.
--
-- A running job holds its scope under a lease the runner renews while it works. A process
-- that dies stops renewing, its lease runs out, and the next claim may take the scope; the
-- dead job itself is failed by reclaim, which asks for the scope again through the same
-- upsert as any other ask -- never by putting the dead row back to pending beside the pending
-- row the scope may already have, which is what the unique index would refuse.
--
-- Every function refuses any role but {{server_role}} itself rather than leaning on the
-- permission list: a role that could call them could run other people's work.

CREATE TABLE {{schema}}.{{prefix}}{{jobs_table}} (
  id bigserial PRIMARY KEY,
  {{scope_column}} {{scope_type}} NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT {{prefix}}{{jobs_table}}_status_check
    CHECK (status IN ('pending', 'running', 'done', 'failed', 'paused')),
  -- Who asked, in the app's own words (a person's write, the sweep, a webhook). The newest
  -- ask before a pass is the one the job keeps.
  source text NOT NULL DEFAULT 'system',
  -- What asked, in words, for reading a queue that has gone wrong.
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  -- When it may be claimed.
  run_after timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  leased_until timestamptz NULL,
  finished_at timestamptz NULL,
  -- Whether the pass changed anything, for the app's own accounting.
  wrote boolean NOT NULL DEFAULT false,
  -- One line about what happened.
  outcome text NULL,
  -- What the pass started on, written as it starts, so a reclaim can tell a pass that dies
  -- on the same thing twice from bad luck.
  attempt text NULL,
  -- Whatever the app wants carried with the ask (what to look at first). The newest ask that
  -- names something keeps it.
  payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX {{prefix}}{{jobs_table}}_one_pending_idx
  ON {{schema}}.{{prefix}}{{jobs_table}} ({{scope_column}}) WHERE status = 'pending';

CREATE INDEX {{prefix}}{{jobs_table}}_due_idx
  ON {{schema}}.{{prefix}}{{jobs_table}} (status, run_after);

CREATE INDEX {{prefix}}{{jobs_table}}_running_idx
  ON {{schema}}.{{prefix}}{{jobs_table}} ({{scope_column}}, leased_until) WHERE status = 'running';

CREATE INDEX {{prefix}}{{jobs_table}}_scope_idx
  ON {{schema}}.{{prefix}}{{jobs_table}} ({{scope_column}}, id DESC);

CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_assert_server()
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF coalesce(nullif(current_setting('hasura.user', true), '')::json ->> 'x-hasura-role', '')
    IS DISTINCT FROM '{{server_role}}'
  THEN
    RAISE EXCEPTION 'The job queue is the server''s own'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

-- Asking for a scope to be looked at. Several asks before a pass are one job: the earliest
-- run_after wins, the newest reason and source, and the newest payload that says anything.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_enqueue(
  job_scope {{scope_type}}, job_source text, job_reason text,
  job_payload jsonb DEFAULT NULL, delay_seconds integer DEFAULT 0
)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  RETURN QUERY
    INSERT INTO {{schema}}.{{prefix}}{{jobs_table}} ({{scope_column}}, source, reason, payload, run_after)
    VALUES (
      job_scope, job_source, job_reason, job_payload,
      now() + make_interval(secs => greatest(coalesce(delay_seconds, 0), 0))
    )
    ON CONFLICT ({{scope_column}}) WHERE status = 'pending'
    DO UPDATE SET
      run_after = least({{schema}}.{{prefix}}{{jobs_table}}.run_after, EXCLUDED.run_after),
      source = EXCLUDED.source,
      reason = EXCLUDED.reason,
      payload = coalesce(EXCLUDED.payload, {{schema}}.{{prefix}}{{jobs_table}}.payload)
    RETURNING *;
END;
$$;

-- Taking one job, and only one per scope. SKIP LOCKED because more than one copy of the app
-- may be asking at once and neither should wait for the other; one per scope because a
-- scope's passes are a sequence, each reading what the last one wrote.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_claim(lease_seconds integer)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  RETURN QUERY
    UPDATE {{schema}}.{{prefix}}{{jobs_table}} j
      SET status = 'running',
          claimed_at = now(),
          leased_until = now() + make_interval(secs => greatest(lease_seconds, 30)),
          attempts = j.attempts + 1
      WHERE j.id = (
        SELECT p.id FROM {{schema}}.{{prefix}}{{jobs_table}} p
        WHERE p.status = 'pending'
          AND p.run_after <= now()
          AND NOT EXISTS (
            SELECT 1 FROM {{schema}}.{{prefix}}{{jobs_table}} r
            WHERE r.{{scope_column}} = p.{{scope_column}}
              AND r.status = 'running'
              AND r.leased_until > now()
          )
        ORDER BY p.run_after, p.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j.*;
END;
$$;

-- The runner saying it is still at work: the lease runs on from now. Answers with the job
-- only while it is still running, so a runner whose job was taken back learns it and stops.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_heartbeat(job_id bigint, lease_seconds integer)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  RETURN QUERY
    UPDATE {{schema}}.{{prefix}}{{jobs_table}} j
      SET leased_until = now() + make_interval(secs => greatest(lease_seconds, 30))
      WHERE j.id = job_id AND j.status = 'running'
      RETURNING j.*;
END;
$$;

-- Putting a job down with a line about what came of it. Only a running job can be
-- finished, so a job already taken back is left as whoever took it back left it; answers
-- with nothing then.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_finish(
  job_id bigint, job_status text, job_wrote boolean, job_outcome text,
  job_attempt text DEFAULT NULL
)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  IF job_status NOT IN ('done', 'failed', 'paused') THEN
    RAISE EXCEPTION 'A job is finished as done, failed or paused, not %', job_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN QUERY
    UPDATE {{schema}}.{{prefix}}{{jobs_table}} j
      SET status = job_status,
          wrote = coalesce(job_wrote, false),
          outcome = left(job_outcome, 2000),
          attempt = coalesce(job_attempt, j.attempt),
          finished_at = now()
      WHERE j.id = job_id AND j.status = 'running'
      RETURNING j.*;
END;
$$;

-- Saying what a running pass has started on.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_mark_attempt(job_id bigint, job_attempt text)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  RETURN QUERY
    UPDATE {{schema}}.{{prefix}}{{jobs_table}} j
      SET attempt = job_attempt
      WHERE j.id = job_id AND j.status = 'running'
      RETURNING j.*;
END;
$$;

-- A job whose runner stopped renewing its lease: the process died, or hung past anything
-- the runner's own timeout could end. Failed with an outcome that says so, and its scope
-- asked for again through the enqueue upsert -- a process dying is usually a deploy, and
-- asking again is the right answer to that.
--
-- Twice is not. A scope whose reclaimed pass was trying the very thing the last reclaimed
-- pass there was trying (attempt), or reclaimed again within repeat_window_seconds, has a
-- pass that kills its process or never finishes, and asking again would only do it again:
-- that job is failed with 'second time running' in its outcome and the scope is NOT asked
-- for again, so the app can stop it and tell someone. SKIP LOCKED so two sweeps at once fail
-- each job once; answers with every job it failed.
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_reclaim(repeat_window_seconds integer DEFAULT 900)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  dead {{schema}}.{{prefix}}{{jobs_table}};
  prior {{schema}}.{{prefix}}{{jobs_table}};
  again boolean;
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  FOR dead IN
    SELECT r.* FROM {{schema}}.{{prefix}}{{jobs_table}} r
    WHERE r.status = 'running'
      AND coalesce(r.leased_until, r.claimed_at + interval '10 minutes', r.created_at) < now()
    ORDER BY r.id
    FOR UPDATE SKIP LOCKED
  LOOP
    prior := NULL;
    SELECT p.* INTO prior FROM {{schema}}.{{prefix}}{{jobs_table}} p
      WHERE p.{{scope_column}} = dead.{{scope_column}}
        AND p.id <> dead.id
        AND p.outcome LIKE 'reclaimed:%'
      ORDER BY p.id DESC
      LIMIT 1;
    again := prior.id IS NOT NULL AND (
      (prior.attempt IS NOT NULL AND prior.attempt = dead.attempt)
      OR prior.finished_at > now() - make_interval(secs => repeat_window_seconds)
    );

    UPDATE {{schema}}.{{prefix}}{{jobs_table}} j
      SET status = 'failed',
          finished_at = now(),
          outcome = left(
            'reclaimed: the pass stopped answering (lease ran out)'
              || CASE WHEN again THEN ', the second time running' ELSE '' END
              || coalesce(' (last: ' || j.outcome || ')', ''),
            500
          )
      WHERE j.id = dead.id
      RETURNING j.* INTO dead;

    IF NOT again THEN
      PERFORM {{schema}}.{{prefix}}{{jobs_table}}_enqueue(
        dead.{{scope_column}}, 'system', 'a pass that stopped answering', dead.payload, 0
      );
    END IF;
    RETURN NEXT dead;
  END LOOP;
END;
$$;

-- The minute hand's housekeeping: throw away what is long done, and answer with what is
-- due, for a runner that wants to know what is waiting. Finding scopes that need asking
-- for is the app's own (it enqueues from its own sweep).
CREATE FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_sweep(retention_days integer DEFAULT 14)
RETURNS SETOF {{schema}}.{{prefix}}{{jobs_table}}
LANGUAGE plpgsql
VOLATILE
AS $$
BEGIN
  PERFORM {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
  DELETE FROM {{schema}}.{{prefix}}{{jobs_table}} j
    WHERE j.status IN ('done', 'failed')
      AND j.finished_at < now() - make_interval(days => retention_days);
  RETURN QUERY
    SELECT * FROM {{schema}}.{{prefix}}{{jobs_table}} j
    WHERE j.status = 'pending' AND j.run_after <= now();
END;
$$;
