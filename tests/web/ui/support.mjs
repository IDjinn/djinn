export function check(condition, message) {
    if (!condition) {
        console.error(`FAIL ${message}`);
        process.exit(1);
    }
}

// Lets pending animation frames and timers of the program run.
export function waitFrames(program, milliseconds = 50) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
