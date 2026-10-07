/** Commands that span teleop and navigation (kept separate to avoid import cycles). */

import { app, notify } from '../state/store';
import { bridge, cancelNavigation, publishZeroVelocity } from './app';
import { teleop } from './teleop';

/**
 * Software STOP: halt teleop, cancel every Nav2 goal, zero the velocity.
 * This is an operator convenience, not a safety-rated emergency stop.
 */
export async function emergencyStop(): Promise<void> {
  teleop.halt();
  if (!bridge.connected) {
    notify('error', 'Safety', 'STOP could not be delivered', 'Not connected to the robot — use the hardware e-stop or stop the launch.');
    return;
  }
  const canceled = await cancelNavigation(true);
  // Zero again after the cancel lands, in case the controller published one last command
  publishZeroVelocity();
  setTimeout(publishZeroVelocity, 150);
  if (canceled) {
    notify('warn', 'Safety', 'Robot stopped', 'Navigation goals canceled and velocity set to zero.');
  } else {
    notify('error', 'Safety', 'Velocity zeroed, but navigation cancel failed', 'Nav2 may resume driving — check the System panel.');
  }
  app().patch({ selection: null });
}
