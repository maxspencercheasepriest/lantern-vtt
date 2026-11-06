// Running inside ChromeOS's Linux container ("Crostini").
//
// Linux apps on a Chromebook run in a container with its own private network,
// on 100.115.92.0/24. The address Lantern sees there is useless to players:
// nothing outside the Chromebook can reach it until the port is forwarded in
// ChromeOS Settings, and then players use the Chromebook's own address, which
// the container cannot see. So we detect this and say what to do instead of
// printing an address that goes nowhere.
import fs from 'node:fs';
import os from 'node:os';

/** 100.115.92.x — the container's side of the ChromeOS bridge. */
export const isCrostiniIp = (ip) => /^100\.115\.92\./.test(String(ip || ''));

/** True when this process is inside a Chromebook's Linux container. */
export function onChromeOS() {
  try {
    if (process.platform !== 'linux') return false;
    if (fs.existsSync('/dev/.cros_milestone')) return true;
    if (fs.existsSync('/opt/google/cros-containers')) return true;
    return Object.values(os.networkInterfaces()).flat()
      .some((i) => i && i.family === 'IPv4' && !i.internal && isCrostiniIp(i.address));
  } catch { return false; }
}

/** What the GM has to do on a Chromebook before anyone can join. */
export function chromeosHosting(port = 3000) {
  return {
    title: 'Hosting from a Chromebook',
    steps: [
      `Open ChromeOS Settings → Linux (Developers) → Port forwarding.`,
      `Add port ${port}, protocol TCP. Leave it on while you play.`,
      `Find your Chromebook's address in Settings → Network → your Wi-Fi → IP address.`,
      `Players use that address and port, e.g. 192.168.1.20:${port}.`,
    ],
    note: `On this Chromebook itself the table is at http://localhost:${port}, and http://penguin.linux.test:${port} also works.`,
    dice: 'GoDice connect over Bluetooth, which the Linux container has no access to. Pair them in a browser tab on the Chromebook, or let another player roll them.',
  };
}

/** The same thing as plain lines, for a terminal or a dialog. */
export function chromeosHostingText(port = 3000) {
  const h = chromeosHosting(port);
  return [h.title, ...h.steps.map((s, i) => `  ${i + 1}. ${s}`), '', `  ${h.note}`].join('\n');
}
