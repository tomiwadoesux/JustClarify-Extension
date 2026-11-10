// A short code a student can quote to have their answers deleted, and the
// board can search by. It is the start of the session id, so it points at one
// row without saying anything about who the student is.
//
// In its own file so the client page, the engine and the board can all import
// it without pulling in node:crypto.

export function refCode(id) {
  return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}
