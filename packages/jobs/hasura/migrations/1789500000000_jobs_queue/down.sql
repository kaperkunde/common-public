DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_sweep(integer);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_reclaim(integer);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_mark_attempt(bigint, text);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_finish(bigint, text, boolean, text, text);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_heartbeat(bigint, integer);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_claim(integer);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_enqueue({{scope_type}}, text, text, jsonb, integer);
DROP FUNCTION {{schema}}.{{prefix}}{{jobs_table}}_assert_server();
DROP TABLE {{schema}}.{{prefix}}{{jobs_table}};
