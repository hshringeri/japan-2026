import { SEGMENTS } from "./train-timetable.js";

// Station-to-station onboard time only: no platform waits, walks, or transfer overhead.
// Transfers are line changes along the ride, so they are counted but add no invented minutes.

const LINE_SEP = "\u0000";

let graph;

function buildGraph() {
  const graph = new Map();
  const station = (name) => {
    let edges = graph.get(name);
    if (!edges) graph.set(name, (edges = []));
    return edges;
  };
  for (const segment of SEGMENTS) {
    const { from, to, line, minutes, source, bidirectional } = segment;
    if (!from || !to || from === to || !Number.isFinite(minutes) || minutes < 0) continue;
    station(from).push({ from, to, line, minutes, source });
    const reverse = station(to);
    if (bidirectional) reverse.push({ from: to, to: from, line, minutes, source });
  }
  return graph;
}

function getGraph() {
  if (!graph) graph = buildGraph();
  return graph;
}

function isLess(a, b) {
  return a.transfers < b.transfers || (a.transfers === b.transfers && a.minutes < b.minutes);
}

function takeCheapest(open) {
  let best = 0;
  for (let i = 1; i < open.length; i++) {
    if (isLess(open[i].cost, open[best].cost)) best = i;
  }
  return open.splice(best, 1)[0];
}

function groupLegs(edges) {
  const legs = [];
  for (const edge of edges) {
    const last = legs[legs.length - 1];
    if (last && last.line === edge.line && last.to === edge.from) {
      last.to = edge.to;
      last.minutes += edge.minutes;
      if (!last.sources.includes(edge.source)) last.sources.push(edge.source);
      continue;
    }
    legs.push({
      from: edge.from,
      to: edge.to,
      line: edge.line,
      minutes: edge.minutes,
      sources: [edge.source],
    });
  }
  return legs;
}

function directJourney(edgesByStation, fromName, toName) {
  const direct = (edgesByStation.get(fromName) || []).filter((edge) => edge.to === toName);
  if (!direct.length) return null;
  let best = direct[0];
  for (const edge of direct) if (edge.minutes < best.minutes) best = edge;
  return {
    minutes: best.minutes,
    transfers: 0,
    legs: [{ from: best.from, to: best.to, line: best.line, minutes: best.minutes, sources: [best.source] }],
  };
}

export function trainJourney(fromName, toName) {
  const edgesByStation = getGraph();
  if (!edgesByStation.has(fromName) || !edgesByStation.has(toName)) return null;
  if (fromName === toName) return { minutes: 0, transfers: 0, legs: [] };

  // A published direct pair is the honest answer even when sampled legs could be
  // added up to a slightly lower number from different runs and dwell times.
  const direct = directJourney(edgesByStation, fromName, toName);
  if (direct) return direct;

  const startKey = fromName + LINE_SEP;
  const dist = new Map([[startKey, { transfers: 0, minutes: 0 }]]);
  const previous = new Map();
  const open = [{ station: fromName, line: null, key: startKey, cost: { transfers: 0, minutes: 0 } }];

  while (open.length) {
    const current = takeCheapest(open);
    if (!current) break;
    const known = dist.get(current.key);
    if (!known || known.transfers !== current.cost.transfers || known.minutes !== current.cost.minutes) continue;

    if (current.station === toName) {
      const path = [];
      let key = current.key;
      while (key !== startKey) {
        const step = previous.get(key);
        path.push(step.edge);
        key = step.key;
      }
      path.reverse();
      const legs = groupLegs(path);
      return {
        minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
        transfers: current.cost.transfers,
        legs,
      };
    }

    for (const edge of edgesByStation.get(current.station) || []) {
      const transfers = current.cost.transfers + (current.line && current.line !== edge.line ? 1 : 0);
      const minutes = current.cost.minutes + edge.minutes;
      const key = edge.to + LINE_SEP + edge.line;
      const prior = dist.get(key);
      const cost = { transfers, minutes };
      if (prior && !isLess(cost, prior)) continue;
      dist.set(key, cost);
      previous.set(key, { key: current.key, edge });
      open.push({ station: edge.to, line: edge.line, key, cost });
    }
  }

  return null;
}

export function stationDirectionsUrl(from, to) {
  if (from?.lat == null || from?.lng == null || to?.lat == null || to?.lng == null) return null;
  const query = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: "transit",
  });
  return `https://www.google.com/maps/dir/?${query}`;
}

export function trainTimeText(journey) {
  if (!journey) return "Check timetable";
  return `${journey.minutes} min`;
}
