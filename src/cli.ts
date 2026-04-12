/**
 * Kauri CLI entry point.
 *
 * This file is the target of `bun build --compile --outfile dist/kauri`.
 * It imports and runs the commander program from `cli/main.ts`.
 */
import { buildProgram } from './cli/main.ts';

const program = buildProgram();
program.parseAsync(process.argv);
