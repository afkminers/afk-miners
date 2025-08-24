// client/js/scenes/house.js
export async function mount({ canvas, hud }) {
  const mod = await import('/js/scenes/explore.js'); // reaproveita a cena
  return mod.mount({ canvas, hud, params: { map: 'house' } });
}
export default { mount };
