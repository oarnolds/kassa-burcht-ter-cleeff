/** Sends the browser to another site (the bank's page). A function of its own so that tests can stand in for it. */
export function leavePage(url: string): void {
  window.location.assign(url);
}
