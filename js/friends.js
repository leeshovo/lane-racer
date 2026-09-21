/*
 * friends.js – Freunde: Rangliste unter Freunden, Freundescode, Hinzufügen per Code oder Link.
 *
 * Aus main.js herausgelöst. Bekommt alles, was es braucht, über `ctx`:
 *   profile, app, online, audio, ui (Oberfläche) und ensureRegistered() (legt bei Bedarf die Online-Identität an).
 * Die Serverseite sind die Funktionen my_friend_code, add_friend, remove_friend und leaderboard_friends.
 */
import { friendShareUrl } from './online.js';
import { copyToClipboard } from './clipboard.js';

export function createFriends(ctx) {
  const friendsTabOpen = () => ctx.app.screen === 'leaderboard' && ctx.app.leaderboardKind === 'friends';
  const boardBase = () => ({ kind: 'friends', meId: ctx.profile.online ? ctx.profile.online.id : null, partyCode: ctx.app.partyCode });

  /** Freunde-Tab der Rangliste laden (Rangliste + eigener Code). */
  async function load(base) {
    const { profile, app, online, ui } = ctx;
    const stale = () => !friendsTabOpen();
    const fail = (text) => ui.renderLeaderboard({ ...base, rows: [], loading: false, error: text });
    if (!profile.name) return fail('Such dir zuerst einen Namen aus – dann kannst du Freunde hinzufügen.');
    if (!(await ctx.ensureRegistered())) return fail('Für Freunde brauchst du eine Verbindung. Versuch es gleich nochmal.');
    const [board, code] = await Promise.all([
      online.friendsBoard(profile.online),
      app.friendCode ? Promise.resolve({ code: app.friendCode }) : online.friendCode(profile.online),
    ]);
    if (stale()) return;
    if (code.code) app.friendCode = code.code;
    ui.renderFriends({ code: app.friendCode || '', canShare: Boolean(navigator.share) });
    ui.renderLeaderboard({ ...base, rows: board.rows || [], loading: false, error: board.error || null });
  }

  async function add(raw) {
    const { profile, app, online, ui, audio } = ctx;
    if (!profile.online) return;
    ui.renderFriends({ code: app.friendCode || '', busy: true, message: 'Wird hinzugefügt …' });
    const res = await online.addFriend(profile.online, raw);
    if (res.error) {
      audio.play('error');
      ui.renderFriends({ code: app.friendCode || '', message: res.error, error: true });
      return;
    }
    audio.play('mission');
    ui.renderFriends({ code: app.friendCode || '', message: `${res.friend.name} ist jetzt dein Freund.`, clearInput: true });
    if (friendsTabOpen()) load(boardBase());
  }

  /** "Freund"-Knopf in der Party-Lobby: gleich hinzufügen und per Meldung bestätigen. */
  async function addFromParty(code) {
    const { profile, online, ui, audio } = ctx;
    if (!profile.online) return;
    const res = await online.addFriend(profile.online, code);
    if (res.error) {
      audio.play('error');
      ui.toast('Freund hinzufügen', res.error, 'error');
      return;
    }
    audio.play('mission');
    ui.toast('Neuer Freund!', `${res.friend.name} ist jetzt dein Freund – ihr seht euch unter Freunde in der Rangliste.`, 'party');
  }

  async function remove(id) {
    const { profile, online, ui } = ctx;
    if (!profile.online) return;
    const res = await online.removeFriend(profile.online, id);
    if (res.error) {
      ui.toast('Nicht geklappt', res.error, 'error');
      return;
    }
    ui.toast('Freund entfernt', 'Ihr seht euch nicht mehr in der Freunde-Liste.', 'info');
    if (friendsTabOpen()) load(boardBase());
  }

  /** Wer einen Einladungslink (?friend=CODE) öffnet, wird gleich mit dem Absender verbunden. */
  async function acceptLink() {
    const { profile, app, online, ui } = ctx;
    const code = app.pendingFriend;
    app.pendingFriend = null;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('friend');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (err) { /* egal */ }
    if (!code || !profile.online) return;
    const res = await online.addFriend(profile.online, code);
    if (res.error) ui.toast('Freundes-Link', res.error, 'error');
    else ui.toast('Neuer Freund!', `Du und ${res.friend.name} seid jetzt verbunden – schau in die Rangliste unter „Freunde“.`, 'party');
  }

  async function copyLink() {
    const { app, ui } = ctx;
    if (!app.friendCode) return;
    const url = friendShareUrl(app.friendCode);
    const ok = await copyToClipboard(url);
    ui.renderFriends(ok
      ? { code: app.friendCode, message: 'Link kopiert – schick ihn deinen Freunden.' }
      : { code: app.friendCode, message: `Kopieren nicht möglich. Dein Link: ${url}`, error: true });
  }

  function shareLink() {
    const { app } = ctx;
    if (!app.friendCode) return;
    const url = friendShareUrl(app.friendCode);
    if (navigator.share) navigator.share({ title: 'Lane Racer', text: `Sei mein Freund in Lane Racer! Code ${app.friendCode}`, url }).catch(() => {});
    else copyLink();
  }

  return { load, add, addFromParty, remove, acceptLink, copyLink, shareLink };
}
