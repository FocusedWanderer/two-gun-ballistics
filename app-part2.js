function syncUi() {
  const any9 = state.slots.some(s => s.cart === "9mm");
  const anyRifle = state.slots.some(s => s.cart !== "9mm");
  document.getElementById("pfBlock").style.display = any9 ? "block" : "none";
  document.getElementById("trimBlock").style.display = anyRifle ? "block" : "none";
  document.getElementById("pfLabel").textContent = state.pf;
  document.getElementById("trimLabel").textContent = `${state.trimPct>0?"+":""}${state.trimPct}%`;
  const wu = state.windUnit === "mph" ? "mph" : "m/s";
  const max = state.windUnit === "mph" ? 30 : 15;
  const ws = document.getElementById("windSpeed");
  ws.max = max;
  if (state.windSpeed > max) { state.windSpeed = max; ws.value = max; }
  document.getElementById("windSpeedLabel").textContent = `${state.windSpeed} ${wu}`;
  document.getElementById("windDegWrap").style.display = state.windPreset === "custom" ? "block" : "none";
  document.getElementById("windDegLabel").textContent = `${state.windDeg}°`;
  document.getElementById("maxDistLabel").textContent = `${state.maxDist} ${state.unit}`;
  const u = state.unit;
  document.getElementById("thD1").textContent = `Drift ${u==="yd"?100:90}`;
  document.getElementById("thD2").textContent = `Drift ${u==="yd"?200:180}`;
  document.getElementById("thD3").textContent = `Drift ${u==="yd"?300:275}`;
}

function seriesValue(inches, dist) {
  if (state.dropUnit === "in") return inches;
  const distYd = state.unit === "yd" ? dist : dist * 1.093613298;
  return inches / (Math.max(1, distYd) / 100);
}


function energyFloorFor(slot, r) {
  if (slot.cart === "9mm") return state.energyFloor["9mm"];
  if (slot.cart === "5.56") return state.energyFloor["5.56"];
  if (slot.cart === "300blk" && r.w.tag === "sub") return state.energyFloor["300sub"];
  return state.energyFloor["300ss"];
}

/** Walk path; return distance in user units where energy or drop limit hits first. */
function maxEffectiveDist(slot, r, path, maxUserDist) {
  const eFloor = energyFloorFor(slot, r);
  const dropLim = state.maxDropIn;
  let hit = maxUserDist;
  let reason = "range";
  // sample every ~1 user unit along labels path points
  for (const s of path) {
    const distUser = state.unit === "yd" ? s.xFt / 3 : s.xFt / 3.280839895;
    if (distUser < 1) continue;
    if (distUser > maxUserDist) break;
    const e = energy(r.w.gr, s.v);
    if (e < eFloor) { hit = distUser; reason = "energy"; break; }
    if (s.dropIn > dropLim) { hit = distUser; reason = "drop"; break; }
  }
  return { dist: Math.round(hit), reason };
}

function update() {
  syncUi();
  const maxFt = toFeet(state.maxDist);
  const zeroFt = toFeet(state.zero);
  const step = state.maxDist <= 100 ? 5 : state.maxDist <= 250 ? 10 : 25;
  const labels = [];
  for (let d = 0; d <= state.maxDist; d += step) labels.push(d);
  const datasets = [];
  const rows = [];
  maxEffMarkers = [];
  const markerDists = state.unit === "yd" ? [100, 200, 300] : [90, 180, 275];

  state.slots.forEach((slot, idx) => {
    const r = resolveSlot(slot);
    const path = simulate(r.mv, r.bc, sightH(r.b.platform), zeroFt, maxFt);
    const color = COLORS[idx % COLORS.length];
    if (state.showDrop) {
      datasets.push({
        label: `${r.name} drop`,
        data: labels.map(d => seriesValue(nearest(path, toFeet(d)).dropIn, d)),
        borderColor: color, tension: 0.15, pointRadius: 0, borderWidth: 2
      });
    }
    if (state.showDrift) {
      datasets.push({
        label: `${r.name} drift`,
        data: labels.map(d => seriesValue(driftInches(nearest(path, toFeet(d)).t || 0), d)),
        borderColor: color, borderDash: [5, 4], tension: 0.15, pointRadius: 0, borderWidth: 1.8
      });
    }
    if (state.showVel) {
      datasets.push({
        label: `${r.name} vel/10`,
        data: labels.map(d => nearest(path, toFeet(d)).v / 10),
        borderColor: color, borderDash: [2, 3], pointRadius: 0, borderWidth: 1.2, tension: 0.15
      });
    }
    if (state.showEnergy) {
      datasets.push({
        label: `${r.name} E/10`,
        data: labels.map(d => energy(r.w.gr, nearest(path, toFeet(d)).v) / 10),
        borderColor: color, borderDash: [1, 2], pointRadius: 0, borderWidth: 1.2, tension: 0.15
      });
    }
    const end = path[path.length - 1] || { v: r.mv, dropIn: 0, t: 0 };
    const drifts = markerDists.map(d => {
      if (d > state.maxDist) return "—";
      const s = nearest(path, toFeet(d));
      return fmtVal(driftInches(s.t || 0), d);
    });
    const me = maxEffectiveDist(slot, r, path, state.maxDist);
    if (state.showMaxEff && me.dist > 0) {
      maxEffMarkers.push({
        dist: me.dist,
        color,
        short: r.name.replace("NATO ", "").slice(0, 14),
        reason: me.reason
      });
    }
    const meNote = me.reason === "energy" ? "E" : me.reason === "drop" ? "drop" : "range";
    rows.push(`<tr>
      <td><span class="swatch" style="background:${color}"></span>${r.name}</td>
      <td>${r.b.label}</td>
      <td>${r.mv} fps</td>
      <td>${r.pf.toFixed(0)}</td>
      <td>${Math.round(end.v)} fps</td>
      <td>${fmtVal(end.dropIn, state.maxDist)}</td>
      <td>${drifts[0]}</td><td>${drifts[1]}</td><td>${drifts[2]}</td>
      <td>${Math.round(energy(r.w.gr, end.v))} ft·lb</td>
      <td><strong>${me.dist} ${state.unit}</strong> <span style="color:var(--muted)">(${meNote})</span></td>
      <td>${suitability(slot, r, state.maxDist)}</td>
    </tr>`);
  });
  buildChart(labels, datasets);
  document.getElementById("cmpBody").innerHTML = rows.join("") || `<tr><td colspan="12">Add a load.</td></tr>`;
}

document.getElementById("addSlot").onclick = () => {
  if (state.slots.length >= 6) return;
  state.slots.push({ id: state.nextId++, cart: "9mm", gr: 124, barrel: "pistol4" });
  renderSlots(); update();
};
document.getElementById("pfSlider").oninput = e => { state.pf = +e.target.value; renderSlots(); update(); };
document.getElementById("trimSlider").oninput = e => { state.trimPct = +e.target.value; renderSlots(); update(); };
document.getElementById("windSpeed").oninput = e => { state.windSpeed = +e.target.value; update(); };
document.getElementById("windDirPreset").onchange = e => { state.windPreset = e.target.value; update(); };
document.getElementById("windDeg").oninput = e => { state.windDeg = +e.target.value; update(); };
document.querySelectorAll("#windUnitToggles button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#windUnitToggles button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const next = btn.dataset.wunit;
  if (next !== state.windUnit) {
    if (next === "mps") state.windSpeed = Math.min(15, Math.round(state.windSpeed / 2.23693629));
    else state.windSpeed = Math.min(30, Math.round(state.windSpeed * 2.23693629));
    document.getElementById("windSpeed").value = state.windSpeed;
    state.windUnit = next;
  }
  update();
}));
document.getElementById("maxDist").oninput = e => { state.maxDist = +e.target.value; update(); };
document.getElementById("zeroCustom").onchange = e => {
  const v = +e.target.value; if (v > 0) { state.zero = v; document.querySelectorAll("#zeroToggles button").forEach(b => b.classList.toggle("active", +b.dataset.zero === v)); update(); }
};
document.querySelectorAll("#zeroToggles button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#zeroToggles button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active"); state.zero = +btn.dataset.zero; document.getElementById("zeroCustom").value = ""; update();
}));
document.querySelectorAll("#unitToggles button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#unitToggles button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const next = btn.dataset.unit;
  if (next !== state.unit) {
    if (next === "m") { state.maxDist = Math.round(state.maxDist * 0.9144 / 5) * 5; state.zero = Math.round(state.zero * 0.9144); document.getElementById("maxDist").max = 450; }
    else { state.maxDist = Math.round(state.maxDist / 0.9144 / 5) * 5; state.zero = Math.round(state.zero / 0.9144); document.getElementById("maxDist").max = 500; }
    state.maxDist = Math.min(+document.getElementById("maxDist").max, Math.max(25, state.maxDist));
    document.getElementById("maxDist").value = state.maxDist; state.unit = next;
  }
  update();
}));
document.querySelectorAll("#dropToggles button").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll("#dropToggles button").forEach(b => b.classList.remove("active"));
  btn.classList.add("active"); state.dropUnit = btn.dataset.drop; update();
}));
["showDrop","showDrift","showVel","showEnergy","showMaxEff"].forEach(id => {
  document.getElementById(id).onchange = e => { state[id] = e.target.checked; update(); };
});
document.getElementById("maxDropIn").oninput = e => {
  state.maxDropIn = +e.target.value || 60;
  document.getElementById("maxDropLabel").textContent = state.maxDropIn;
  update();
};
document.getElementById("e9").oninput = e => { state.energyFloor["9mm"] = +e.target.value || 200; update(); };
document.getElementById("e556").oninput = e => { state.energyFloor["5.56"] = +e.target.value || 500; update(); };
document.getElementById("e300ss").oninput = e => { state.energyFloor["300ss"] = +e.target.value || 600; update(); };
document.getElementById("e300sub").oninput = e => { state.energyFloor["300sub"] = +e.target.value || 400; update(); };

renderSlots();
update();
