#!/usr/bin/env node
import { main } from "./scaffold"

process.exitCode = main(process.argv.slice(2), (line) => console.log(line))
