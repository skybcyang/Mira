export function createDesktopStateWriter({ writeState, onBackgroundError = () => {} }) {
  let tail = Promise.resolve()

  function write(snapshot) {
    const operation = tail
      .catch(() => undefined)
      .then(() => writeState(snapshot))
    tail = operation
    return operation
  }

  function writeInBackground(snapshot) {
    void write(snapshot).catch(onBackgroundError)
  }

  return { write, writeInBackground }
}
