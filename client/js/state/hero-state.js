// /client/js/state/hero-state.js
export const HeroState = {
  alive: true,
  hp: 1,
  max_hp: 1,
  mana: 0,
  max_mana: 0,

  // opcional, mas útil p/ debugging/integração
  id: null,
  heroClass: null,
  name: null,

  // aceita vários formatos de payload: {profile:{...}}, {alive,hp,max_hp}, etc
  setFromServer(payload) {
    if (!payload) return;

    const p = payload.profile ? payload.profile : payload;

    // tenta detectar campos comuns
    const alive =
      (typeof p.alive === 'boolean') ? p.alive
      : (typeof p.isAlive === 'boolean') ? p.isAlive
      : (p.hp != null ? Number(p.hp) > 0 : this.alive);

    const hp     = (p.hp != null) ? Number(p.hp) : (p.currentHp != null ? Number(p.currentHp) : this.hp);
    const max_hp = (p.max_hp != null) ? Number(p.max_hp) : (p.maxHp != null ? Number(p.maxHp) : this.max_hp);

    const mana =
      (p.mana != null) ? Number(p.mana)
      : (p.mp != null) ? Number(p.mp)
      : this.mana;

    const max_mana =
      (p.max_mana != null) ? Number(p.max_mana)
      : (p.maxMana != null) ? Number(p.maxMana)
      : (p.max_mp != null) ? Number(p.max_mp)
      : (p.manaMax != null) ? Number(p.manaMax)
      : this.max_mana;

    const name =
      p.name ?? p.heroName ?? p.displayName ?? p.nickname ?? this.name;

    this.alive  = !!alive;
    if (Number.isFinite(hp)) this.hp = hp;
    if (Number.isFinite(max_hp)) this.max_hp = max_hp;
    if (Number.isFinite(mana)) this.mana = mana;
    if (Number.isFinite(max_mana)) this.max_mana = max_mana;
    if (name != null) this.name = String(name);

    // meta leve (se vier)
    const id = p.id ?? p.heroId ?? p.playerId ?? null;
    const klass = p.class ?? p.heroClass ?? null;
    if (id != null) this.id = String(id);
    if (klass != null) this.heroClass = String(klass);

    // notifica UI/sistemas
    try {
      window.dispatchEvent(new CustomEvent('hero:state', {
        detail: {
          alive: this.alive,
          hp: this.hp,
          max_hp: this.max_hp,
          mana: this.mana,
          max_mana: this.max_mana,
          id: this.id,
          heroClass: this.heroClass,
          name: this.name,
        }
      }));
    } catch {}
  }
};
