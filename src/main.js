// ==========================================================================
// REFLEXRUN 3D - MAIN APPLICATION ENTRY POINT
// ==========================================================================

import { GameController } from './game/GameController.js';

window.addEventListener('DOMContentLoaded', async () => {
  console.log('⚡ Initializing ReflexRun 3D Workout Game...');
  const game = new GameController();
  await game.init();
  game.update();
});
