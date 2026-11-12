#!/usr/bin/env node
import { main } from "./cli-main"

process.exitCode = main(process.argv.slice(2), (line) => console.log(line))
