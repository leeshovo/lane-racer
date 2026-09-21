/*
 * tutorial.js – kurze Tipps in der allerersten Runde.
 *
 * Reine Logik ohne Oberfläche: update() bekommt den aktuellen Spielstand und liefert den Tipp,
 * der gerade angezeigt werden soll (oder null). Die Tipps erscheinen nacheinander, jeweils erst
 * dann, wenn sie passen (z. B. "Nitro bereit!" wenn die Leiste gefüllt ist), und verschwinden,
 * sobald man das Gezeigte getan hat – oder nach einer Weile von selbst.
 */

const GAP_BETWEEN_TIPS = 1.6; // Sekunden Ruhe zwischen zwei Tipps

/**
 * Jeder Schritt: id, Text (je Gerät), wann er kommt (`when`), wann er erledigt ist (`done`),
 * und nach wie vielen Sekunden er sich von selbst zurückzieht.
 */
export const TUTORIAL_STEPS = [
  {
    id: 'steer',
    text: (touch) => (touch ? 'Tippe links oder rechts, um die Spur zu wechseln' : 'Wechsle die Spur mit ← → (oder A / D)'),
    when: () => true,
    done: (s) => s.laneChanges >= 2,
    timeout: 12,
  },
  {
    id: 'coins',
    text: () => 'Sammle Münzen – damit kaufst du in der Garage neue Autos',
    when: (s) => s.distance >= 120,
    done: (s) => s.coins >= 1,
    timeout: 8,
  },
  {
    id: 'near',
    text: () => 'Fahr knapp an Autos vorbei: Beinahe-Unfälle geben Münzen und laden Nitro',
    when: (s) => s.distance >= 300,
    done: (s) => s.nearMisses >= 1,
    timeout: 9,
  },
  {
    id: 'nitro',
    text: (touch) => (touch ? 'Nitro ist bereit – tippe auf den Nitro-Knopf!' : 'Nitro ist bereit – drücke die Leertaste!'),
    when: (s) => s.nitroReady && !s.nitroActive,
    done: (s) => s.nitroUses >= 1,
    timeout: 9,
  },
  {
    id: 'ability',
    text: (touch, s) => (touch ? `${s.abilityName || 'Fähigkeit'} ist bereit – tippe auf den Knopf!` : `${s.abilityName || 'Fähigkeit'} ist bereit – drücke F (oder E)!`),
    when: (s) => s.abilityReady && s.distance >= 500,
    done: (s) => s.abilityUses >= 1,
    timeout: 9,
  },
];

export class Tutorial {
  constructor({ touch = false } = {}) {
    this.touch = touch;
    this.reset();
  }

  reset() {
    this.index = 0;
    this.shownFor = 0;   // Sekunden, die der aktuelle Tipp schon zu sehen ist
    this.cooldown = 0;   // Ruhe nach einem Tipp
    this.active = false; // der aktuelle Schritt wird gerade angezeigt
    this.laneChanges = 0;
    this.abilityUses = 0;
    this.nitroUses = 0;
    this.prevLane = null;
    this.prevAbilityActive = false;
    this.prevNitroActive = false;
    this.startDistance = 0;
    this.completed = [];
  }

  get finished() { return this.index >= TUTORIAL_STEPS.length; }

  /**
   * @param s  { distance, lane, coins, nearMisses, nitroReady, nitroActive, abilityReady, abilityActive, abilityName }
   * @param dt Sekunden seit dem letzten Aufruf
   * @returns {{id:string, text:string, step:number, steps:number}|null}
   */
  update(s, dt) {
    if (this.finished) return null;

    // Beobachten, was der Spieler tut
    if (this.prevLane !== null && s.lane !== this.prevLane) this.laneChanges += 1;
    this.prevLane = s.lane;
    if (s.abilityActive && !this.prevAbilityActive) this.abilityUses += 1;
    this.prevAbilityActive = Boolean(s.abilityActive);
    if (s.nitroActive && !this.prevNitroActive) this.nitroUses += 1;
    this.prevNitroActive = Boolean(s.nitroActive);

    const state = { ...s, laneChanges: this.laneChanges, abilityUses: this.abilityUses, nitroUses: this.nitroUses };
    const step = TUTORIAL_STEPS[this.index];

    if (!this.active) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown > 0 || !step.when(state)) return null;
      this.active = true;
      this.shownFor = 0;
    }

    this.shownFor += dt;
    if (step.done(state) || this.shownFor >= step.timeout) {
      if (step.done(state)) this.completed.push(step.id);
      this.active = false;
      this.index += 1;
      this.cooldown = GAP_BETWEEN_TIPS;
      return null;
    }
    return { id: step.id, text: step.text(this.touch, state), step: this.index + 1, steps: TUTORIAL_STEPS.length };
  }
}
