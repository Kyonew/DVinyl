/**
 * A refusal to start that the person running DVinyl can act on, worded for them: printed
 * as is at boot, without the stack trace, which tells them nothing.
 */
export class StartupError extends Error {}
