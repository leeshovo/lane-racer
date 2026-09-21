/*
 * input.js – Tastatur und Touch-Knöpfe.
 *
 * Aus main.js herausgelöst. createInput(ctx) hängt die Tastatur-Ereignisse ein und liefert handleTouch()
 * für die Knöpfe auf dem Handy. ctx: game (Getter), app, profile, ui und die Rückrufe
 * unlockAudio, changeSettings, setPaused, startRun, toMenu, goBack.
 */

/** Einheitlicher Tastenname; manche Umgebungen liefern event.code leer. */
export function keyName(event) {
  if (event.code) return event.code;
  const key = event.key || '';
  if (key === ' ') return 'Space';
  if (key.length === 1) return `Key${key.toUpperCase()}`;
  return key;
}

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export function createInput(ctx) {
  window.addEventListener('keydown', (event) => {
    const { app, profile, ui } = ctx;
    const game = ctx.game;
    if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
    if (!game) return;
    ctx.unlockAudio();
    const code = keyName(event);
    const inRun = game.state === 'playing' || game.state === 'countdown';

    if (code === 'KeyM' && !event.repeat) {
      const muted = profile.settings.music || profile.settings.sfx;
      ctx.changeSettings({ music: !muted, sfx: !muted });
      ui.toast(muted ? 'Ton aus' : 'Ton an', 'Taste M schaltet um', 'info');
      return;
    }

    if (inRun && !app.paused) {
      if (GAME_KEYS.has(code)) event.preventDefault();
      switch (code) {
        case 'ArrowLeft': case 'KeyA':
          if (!event.repeat) game.changeLane(-1);
          break;
        case 'ArrowRight': case 'KeyD':
          if (!event.repeat) game.changeLane(1);
          break;
        case 'ArrowUp': case 'KeyW':
          game.setGas(true);
          break;
        case 'ArrowDown': case 'KeyS':
          game.setBrake(true);
          break;
        case 'Space': case 'ShiftLeft': case 'ShiftRight': case 'KeyN':
          if (!event.repeat) game.triggerNitro();
          break;
        case 'KeyF': case 'KeyE':
          if (!event.repeat) game.useAbility();
          break;
        case 'KeyP': case 'Escape':
          if (!event.repeat) ctx.setPaused(true);
          break;
        case 'KeyH':
          if (!event.repeat) game.setDebugHitboxes(!game.debugHitboxes);
          break;
        default:
          break;
      }
      return;
    }

    if (app.paused) {
      // Einstellungen aus der Pause: Esc geht zurück zur Pause (statt weiterzufahren)
      if (app.screen === 'settings') {
        if (code === 'Escape' && !event.repeat) {
          event.preventDefault();
          ctx.goBack();
        }
        return;
      }
      if (!event.repeat && ['KeyP', 'Escape', 'Enter'].includes(code)) {
        event.preventDefault();
        ctx.setPaused(false);
      }
      return;
    }

    // Menüs: Enter/Leertaste nur, wenn kein Button den Fokus hat (sonst doppelt)
    const onButton = event.target instanceof Element && event.target.closest('button, a, [role="button"]');
    if (app.screen === 'gameover' && !event.repeat) {
      if ((code === 'Enter' || code === 'Space') && !onButton && performance.now() - app.gameOverAt > 700) {
        event.preventDefault();
        ctx.startRun({});
      } else if (code === 'Escape') {
        ctx.toMenu();
      }
    } else if (app.screen === 'menu' && !event.repeat && (code === 'Enter' || code === 'Space') && !onButton) {
      event.preventDefault();
      ctx.startRun({});
    } else if (app.screen !== 'menu' && app.screen !== 'hud' && code === 'Escape' && !event.repeat) {
      ctx.goBack();
    }
  });

  window.addEventListener('keyup', (event) => {
    const game = ctx.game;
    if (!game) return;
    switch (keyName(event)) {
      case 'ArrowUp': case 'KeyW':
        game.setGas(false);
        break;
      case 'ArrowDown': case 'KeyS':
        game.setBrake(false);
        break;
      default:
        break;
    }
  });

  /** Knöpfe der Touch-Steuerung (siehe ui.js: onTouch). */
  function handleTouch(action) {
    const game = ctx.game;
    ctx.unlockAudio();
    if (ctx.app.paused) return;
    switch (action) {
      case 'left': game.changeLane(-1); break;
      case 'right': game.changeLane(1); break;
      case 'nitro': game.triggerNitro(); break;
      case 'ability': game.useAbility(); break;
      case 'gas:down': game.setGas(true); break;
      case 'gas:up': game.setGas(false); break;
      case 'brake:down': game.setBrake(true); break;
      case 'brake:up': game.setBrake(false); break;
      default: break;
    }
  }

  return { handleTouch };
}
