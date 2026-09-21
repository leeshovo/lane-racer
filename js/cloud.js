/*
 * cloud.js – Cloud-Spielstand und Sicherungscode.
 *
 * Aus main.js herausgelöst. Der Spielstand wird nach jeder Runde (und nach Käufen) online gesichert und beim
 * Start mit dem Stand in der Cloud verglichen: Der weiter fortgeschrittene gewinnt. Mit dem Sicherungscode
 * (Online-ID + Geheimnis) holt man den Stand auf einem anderen Gerät zurück.
 *
 * ctx: profile, app, online, audio, ui, game (Getter) und die Rückrufe ensureRegistered, leaveParty, refreshScreens.
 */
import { saveProfile, snapshotOf, adoptSnapshot, progressOf, colorOf } from './storage.js';
import { makeRecoveryCode, parseRecoveryCode } from './online.js';
import { copyToClipboard } from './clipboard.js';

export function createCloud(ctx) {
  function scheduleSave(delay = 2500) {
    clearTimeout(ctx.app.cloud.timer);
    ctx.app.cloud.timer = setTimeout(push, delay);
  }

  async function push() {
    const { profile, app, online } = ctx;
    if (!profile.online || online.status !== 'online') return false;
    const res = await online.saveProfile(profile.online, snapshotOf(profile));
    if (!res.savedAt) return false;
    app.cloud.savedAt = res.savedAt;
    if (app.screen === 'settings') refreshRecoveryUi();
    return true;
  }

  /** Beim Start: Ist in der Cloud ein weiterer Spielstand als auf diesem Gerät? Dann den übernehmen. */
  async function pull() {
    const { profile, app, online, ui } = ctx;
    if (!profile.online || online.status !== 'online') return;
    const res = await online.loadProfile(profile.online);
    if (res.error) {
      // Der Server kennt dieses Online-Profil nicht (mehr): neues anlegen, der lokale Spielstand bleibt erhalten
      if (res.code === 'auth') {
        profile.online = null;
        saveProfile(profile);
        if (await ctx.ensureRegistered()) push();
      }
      return;
    }
    app.cloud.savedAt = res.updatedAt;
    const cloudProgress = progressOf(res.data);
    const localProgress = progressOf(profile);
    if (res.data && cloudProgress > localProgress) {
      adoptSnapshot(profile, res.data);
      saveProfile(profile);
      ui.toast('Spielstand geladen', 'Ein weiterer Stand aus der Cloud wurde übernommen.', 'info');
      afterProfileChanged();
    } else if (localProgress > cloudProgress) {
      push();
    }
    if (app.screen === 'settings') refreshRecoveryUi();
  }

  /** Nach dem Laden/Wiederherstellen alles auffrischen, was den Spielstand zeigt. */
  function afterProfileChanged() {
    const { profile, game } = ctx;
    if (game.state === 'idle') game.setPlayerCar(profile.selectedCar, colorOf(profile, profile.selectedCar));
    ctx.refreshScreens();
  }

  function refreshRecoveryUi() {
    const { profile, app, online, ui } = ctx;
    let status;
    if (!profile.online) status = 'Melde dich mit einem Namen an – dann wird dein Spielstand gesichert.';
    else if (online.status !== 'online') status = 'Offline – gesichert wird, sobald du wieder online bist.';
    else if (app.cloud.savedAt) status = `Zuletzt gesichert: ${new Date(app.cloud.savedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr`;
    else status = 'Wird nach deiner nächsten Runde gesichert.';
    ui.setRecoveryCode({
      code: makeRecoveryCode(profile.online),
      hasProgress: profile.stats.runs > 0 || profile.stats.totalCoins > 0,
      status,
    });
  }

  async function copyRecovery() {
    const code = makeRecoveryCode(ctx.profile.online);
    if (!code) return;
    const ok = await copyToClipboard(code);
    if (ok) ctx.ui.toast('Sicherungscode kopiert', 'In der Zwischenablage', 'info');
    else ctx.ui.toast('Kopieren nicht möglich', code, 'error');
  }

  /** Stellt einen Spielstand auf diesem Gerät wieder her (Code stammt von einem anderen Gerät). */
  async function restoreFromCode(text) {
    const { profile, app, online, ui, audio } = ctx;
    const identity = parseRecoveryCode(text);
    if (!identity) {
      ui.setRestoreResult({ ok: false, message: 'Dieser Sicherungscode ist ungültig. Kopiere ihn vollständig, er beginnt mit LR1-.' });
      return;
    }
    const res = await online.loadProfile(identity);
    if (res.error) {
      ui.setRestoreResult({ ok: false, message: res.code === 'auth' ? 'Zu diesem Code gibt es keinen Spieler. Prüfe, ob du ihn richtig kopiert hast.' : res.error });
      return;
    }
    if (app.party) await ctx.leaveParty();
    profile.online = identity;
    profile.name = res.name;
    if (res.data) adoptSnapshot(profile, res.data);
    else profile.best = Math.max(profile.best, res.best);
    saveProfile(profile);
    app.cloud.savedAt = res.updatedAt;
    afterProfileChanged();
    refreshRecoveryUi();
    ui.setRestoreResult({ ok: true, message: `Willkommen zurück, ${res.name}! Dein Spielstand ist wiederhergestellt.` });
    audio.play('buy');
  }

  return { scheduleSave, push, pull, afterProfileChanged, refreshRecoveryUi, copyRecovery, restoreFromCode };
}
