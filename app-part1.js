const COLORS = ["#3d9cf0","#3ecf8e","#f0b429","#f07178","#c678dd","#56b6c2","#e5c07b","#d19a66"];
const CATALOG = {
  "9mm": {
    label: "9mm",
    barrels: [
      { id: "pistol4", label: "Pistol ~4\"", platform: "pistol" },
      { id: "pcc16", label: "PCC ~16\"", platform: "carbine" }
    ],
    weights: [
      { gr: 115, bc: 0.130, mv: { pistol4: 1150, pcc16: 1350 } },
      { gr: 124, bc: 0.150, mv: { pistol4: 1120, pcc16: 1300 } },
      { gr: 148, bc: 0.170, mv: { pistol4: 950, pcc16: 1120 } }
    ]
  },
  "5.56": {
    label: "5.56 NATO",
    barrels: [
      { id: "carb145", label: "Carbine 14.5\"", platform: "carbine" },
      { id: "carb16", label: "Carbine 16\"", platform: "carbine" }
    ],
    weights: [
      { gr: 55, bc: 0.243, mv: { carb145: 3025, carb16: 3165 } },
      { gr: 62, bc: 0.304, mv: { carb145: 2900, carb16: 3020 } },
      { gr: 77, bc: 0.372, mv: { carb145: 2600, carb16: 2720 } }
    ]
  },
  "300blk": {
    label: ".300 BLK",
    barrels: [
      { id: "sbr9", label: "SBR ~9\"", platform: "carbine" },
      { id: "rif16", label: "16\"", platform: "carbine" }
    ],
    weights: [
      { gr: 110, bc: 0.300, mv: { sbr9: 2250, rif16: 2350 }, tag: "super" },
      { gr: 125, bc: 0.320, mv: { sbr9: 2150, rif16: 2250 }, tag: "super" },
      { gr: 200, bc: 0.650, mv: { sbr9: 1000, rif16: 1050 }, tag: "sub" }
    ]
  }
};

const state = {
  slots: [
    { id: 1, cart: "9mm", gr: 124, barrel: "pcc16" },
    { id: 2, cart: "5.56", gr: 55, barrel: "carb16" }
  ],
  nextId: 3,
  pf: 125,
  trimPct: 0,
  zero: 100,
  unit: "yd",
  dropUnit: "in",
  maxDist: 300,
  showDrop: true,
  showDrift: true,
  showVel: false,
  showEnergy: false,
  showMaxEff: true,
  maxDropIn: 60,
  energyFloor: { "9mm": 200, "5.56": 500, "300ss": 600, "300sub": 400 },
  windSpeed: 10,
  windUnit: "mph",
  windPreset: "cross",
  windDeg: 90
};

function g1DragFactor(v) {
  const pts = [[0,0],[500,45],[800,70],[1000,95],[1120,120],[1400,170],[1600,210],[1800,260],[2000,320],[2200,390],[2400,470],[2600,560],[2800,660],[3000,770],[3200,890],[3500,1100],[4000,1450]];
  if (v <= 0) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i][0]) {
      const [x0,y0]=pts[i-1],[x1,y1]=pts[i];
      return y0 + (y1 - y0) * (v - x0) / (x1 - x0);
    }
  }
  return pts[pts.length-1][1];
}
const G = 32.174;
const toFeet = d => state.unit === "yd" ? d * 3 : d * 3.280839895;
const sightH = p => p === "pistol" ? 0.9 : 1.5;
const energy = (gr, fps) => (gr * fps * fps) / 450240;
const pfOf = (gr, fps) => (gr * fps) / 1000;

function windMph() {
  return state.windUnit === "mph" ? state.windSpeed : state.windSpeed * 2.23693629;
}
function windFps() {
  return windMph() * 1.4666667;
}
/** Angle from shooter: 0 head, 90 full cross, 180 tail */
function windAngleDeg() {
  if (state.windPreset === "cross") return 90;
  if (state.windPreset === "head") return 0;
  if (state.windPreset === "tail") return 180;
  return state.windDeg;
}
function crosswindFactor() {
  const rad = windAngleDeg() * Math.PI / 180;
  return Math.abs(Math.sin(rad));
}
function driftInches(tofSec) {
  return windFps() * tofSec * 12 * crosswindFactor();
}

function resolveSlot(slot) {
  const cat = CATALOG[slot.cart];
  const w = cat.weights.find(x => x.gr === +slot.gr) || cat.weights[0];
  const b = cat.barrels.find(x => x.id === slot.barrel) || cat.barrels[0];
  let baseMv = w.mv[b.id] || Object.values(w.mv)[0];
  let bc = w.bc, mv = baseMv, pf;
  if (slot.cart === "9mm") {
    const target = (state.pf * 1000) / w.gr;
    mv = Math.min(baseMv * 1.35, Math.max(baseMv * 0.75, target));
    bc = w.bc * (1 + (mv / baseMv - 1) * 0.08);
    pf = pfOf(w.gr, mv);
  } else {
    mv = baseMv * (1 + state.trimPct / 100);
    pf = pfOf(w.gr, mv);
  }
  return {
    cat, w, b, mv: Math.round(mv), bc, pf, baseMv,
    name: `${cat.label} ${w.gr}gr${w.tag === "sub" ? " Sub" : w.tag === "super" ? " Super" : ""}`
  };
}

function fly(mv, bc, sightHIn, angle, maxDistFt, dt, collect, sampleStep, zeroX) {
  let vx = mv * Math.cos(angle), vy = mv * Math.sin(angle);
  let x = 0, y = -sightHIn / 12, t = 0;
  const out = [];
  let nextSample = 0, yAtZero = 0;
  while (x < maxDistFt + sampleStep && t < 5) {
    const v = Math.hypot(vx, vy);
    if (v < 50) break;
    const drag = g1DragFactor(v) / Math.max(0.05, bc);
    const ax = -drag * (vx / v);
    const ay = -G - drag * (vy / v);
    vx += ax * dt; vy += ay * dt;
    x += vx * dt; y += vy * dt; t += dt;
    if (!collect && x >= zeroX) { yAtZero = y * 12; break; }
    if (collect && x >= nextSample) {
      out.push({ xFt: x, dropIn: -y * 12, v: Math.hypot(vx, vy), t });
      nextSample += sampleStep;
    }
  }
  return collect ? out : { yAtZero };
}

function simulate(mv, bc, sightHIn, zeroDistFt, maxDistFt) {
  const dt = 0.0005;
  let angle = 0;
  for (let i = 0; i < 18; i++) {
    const hit = fly(mv, bc, sightHIn, angle, zeroDistFt, dt, false, 5, zeroDistFt);
    angle -= (hit.yAtZero / 12) / Math.max(50, zeroDistFt) * 0.85;
  }
  return fly(mv, bc, sightHIn, angle, maxDistFt, dt, true, Math.max(1, maxDistFt / 120), zeroDistFt);
}

function nearest(path, xFt) {
  let best = path[0] || { dropIn: 0, v: 0, t: 0 };
  for (const s of path) if (Math.abs(s.xFt - xFt) < Math.abs(best.xFt - xFt)) best = s;
  return best;
}

function fmtVal(inches, distUser) {
  if (state.dropUnit === "in") return `${inches.toFixed(1)} in`;
  const distYd = state.unit === "yd" ? distUser : distUser * 1.093613298;
  return `${(inches / (Math.max(1, distYd) / 100)).toFixed(1)} MOA`;
}

function suitability(slot, r, maxD) {
  if (slot.cart === "9mm") {
    if (maxD <= 50) return "Solid for typical pistol/PCC stages.";
    if (maxD <= 100) return "Usable with known holds.";
    return "Past ~100 yd rifle usually better.";
  }
  if (slot.cart === "300blk" && r.w.tag === "sub") return maxD <= 75 ? "OK close suppressed." : "Steep drop — plan holds.";
  if (slot.cart === "5.56") return maxD <= 200 ? "Excellent for two-gun rifle legs." : "Still flat for 300+ planning.";
  return maxD <= 150 ? "Good mid-range carbine." : "Check holds past 200.";
}

let chart;
let maxEffMarkers = []; // {dist, label, color}

const maxEffPlugin = {
  id: "maxEffLines",
  afterDatasetsDraw(chart) {
    if (!state.showMaxEff || !maxEffMarkers.length) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const top = chartArea.top;
    const bottom = chartArea.bottom;
    ctx.save();
    maxEffMarkers.forEach(m => {
      // find nearest label index
      const labels = chart.data.labels;
      let best = 0, bestDiff = Infinity;
      labels.forEach((lab, i) => {
        const d = Math.abs(+lab - m.dist);
        if (d < bestDiff) { bestDiff = d; best = i; }
      });
      const x = xScale.getPixelForValue(best);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.color;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      const text = `${m.short} ${m.dist}${state.unit}`;
      ctx.fillText(text, x, top + 12);
    });
    ctx.restore();
  }
};

function buildChart(labels, datasets) {
  const ctx = document.getElementById("dropChart").getContext("2d");
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#c5d0e0", filter: (item) => !String(item.text).startsWith("▸") } } },
      scales: {
        x: { title: { display: true, text: `Distance (${state.unit})`, color: "#8b9bb4" }, ticks: { color: "#8b9bb4" }, grid: { color: "#243044" } },
        y: { title: { display: true, text: state.dropUnit === "in" ? "Inches (drop / drift)" : "MOA (drop / drift)", color: "#8b9bb4" }, ticks: { color: "#8b9bb4" }, grid: { color: "#243044" } }
      }
    },
    plugins: [maxEffPlugin]
  });
}

function renderSlots() {
  const el = document.getElementById("slots");
  el.innerHTML = state.slots.map((slot, idx) => {
    const cat = CATALOG[slot.cart];
    const color = COLORS[idx % COLORS.length];
    const weightOpts = cat.weights.map(w => `<option value="${w.gr}" ${+slot.gr===w.gr?"selected":""}>${w.gr}gr${w.tag?" ("+w.tag+")":""} · BC ${w.bc.toFixed(3)}</option>`).join("");
    const barrelOpts = cat.barrels.map(b => `<option value="${b.id}" ${slot.barrel===b.id?"selected":""}>${b.label}</option>`).join("");
    const cartOpts = Object.keys(CATALOG).map(k => `<option value="${k}" ${slot.cart===k?"selected":""}>${CATALOG[k].label}</option>`).join("");
    const r = resolveSlot(slot);
    return `<div class="slot"><div class="slot-head">
      <span class="title"><span class="swatch" style="background:${color}"></span>Slot ${idx+1}</span>
      <button type="button" data-remove="${slot.id}" ${state.slots.length<=1?"disabled":""}>Remove</button>
    </div><div class="fields">
      <div><label>Cartridge</label><select data-field="cart" data-id="${slot.id}">${cartOpts}</select></div>
      <div><label>Bullet weight</label><select data-field="gr" data-id="${slot.id}">${weightOpts}</select></div>
      <div class="full"><label>Barrel</label><select data-field="barrel" data-id="${slot.id}">${barrelOpts}</select></div>
      <div class="full hint">Baseline ~${r.baseMv} fps → <strong style="color:var(--text)">${r.mv} fps</strong> · BC ${r.bc.toFixed(3)} · PF ${r.pf.toFixed(1)}</div>
    </div></div>`;
  }).join("");
  el.querySelectorAll("select").forEach(sel => {
    sel.addEventListener("change", () => {
      const slot = state.slots.find(s => s.id === +sel.dataset.id);
      if (!slot) return;
      if (sel.dataset.field === "cart") {
        slot.cart = sel.value;
        const cat = CATALOG[slot.cart];
        slot.gr = cat.weights[0].gr; slot.barrel = cat.barrels[0].id;
      } else if (sel.dataset.field === "gr") slot.gr = +sel.value;
      else slot.barrel = sel.value;
      renderSlots(); update();
    });
  });
  el.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.slots = state.slots.filter(s => s.id !== +btn.dataset.remove);
      renderSlots(); update();
    });
  });
}
