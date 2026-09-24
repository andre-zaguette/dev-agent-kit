// Prints output forever; used to prove runProcess bounds what it keeps.
const line = 'x'.repeat(1023) + '\n';
function pump() {
  while (process.stdout.write(line)) {}
  process.stdout.once('drain', pump);
}
pump();
