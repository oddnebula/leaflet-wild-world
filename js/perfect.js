// The perfect-town rating exactly as the game works it out (the decompilation's acre survey func_0204a1c0 / func_02049e40,
// the acre score func_0204a630 and the town rating func_02049990).
//  Each acre starts at 100. Trees (grown or growing, fruit, money, special and palm trees; plain and cedar saplings
//  don't count) outside 12–15 cost 2 each. From the third weed on (only the four weed kinds), each costs 1; so does each
//  piece of junk from the third on (things left on the ground: furniture, gyroids, clothes, tools, letters and the like,
//  not buried). Each can, boot or tyre costs 10, a Rafflesia 50, and each flower from the third on (any flower, watered
//  or not, Jacob's Ladder, gold roses and dandelions; wilted ones and the Rafflesia don't) adds 1.
//  Acre bands: under 75, under 80, under 95, under 101, 101 and up. The town is perfect when no acre is under 95 and at
//  least 8 acres reach 101.
(function () {
  'use strict';
  const MAP = 0xC354, BURIED = 0xE354;
  const isTree = v => (v >= 0x26 && v <= 0x2A) || (v >= 0x2F && v <= 0x5B) || (v >= 0x5D && v <= 0x61) || (v >= 0x66 && v <= 0x6D) || (v >= 0xC8 && v <= 0xCF);
  const isWeed = v => v >= 0x21 && v <= 0x24;
  const isFlower = v => (v <= 0x1D && v !== 0x1B) || (v >= 0x8A && v <= 0xA3) || v === 0xA5;   // wilted ones don't count
  const isGarbage = v => v >= 0x1320 && v <= 0x1322;
  // Junk: class 1 items other than coconuts, fruit, garbage, spoiled turnips, shells and fossils; all of class 2–4;
  // only when lying on the ground (a buried item doesn't count).
  function isJunk(v) {
    const c = v >> 12;
    if (c === 3 || c === 4) return true;
    if (c === 2) return true;
    if (c !== 1) return false;
    if (v === 0x1548 || v === 0x1568 || isGarbage(v)) return false;
    if ((v >= 0x1518 && v <= 0x151C) || (v >= 0x1542 && v <= 0x1546) || (v >= 0x154A && v <= 0x155C)) return false;
    return true;
  }
  const BANDS = [[75, 'Poor'], [80, 'Untidy'], [95, 'Okay'], [101, 'Good'], [Infinity, 'Excellent']];
  const band = score => BANDS.findIndex(([lim]) => score < lim);

  function acre(s, a) {
    let trees = 0, weeds = 0, junk = 0, garbage = 0, flowers = 0, rafflesia = false;
    for (let k = 0; k < 256; k++) {
      const i = a * 256 + k, v = s.u16(MAP + i * 2), buried = (s.u8(BURIED + (i >> 3)) >> (i & 7)) & 1;
      if (isTree(v)) trees++;
      else if (isWeed(v)) weeds++;
      else if (v === 0x1B) rafflesia = true;
      else if (isFlower(v)) flowers++;
      else if (isGarbage(v)) garbage++;
      else if (!buried && isJunk(v)) junk++;
    }
    let score = 100;
    if (trees > 15) score -= (trees - 15) * 2; else if (trees < 12) score -= (12 - trees) * 2;
    if (weeds >= 3) score -= weeds - 2;
    if (junk >= 3) score -= junk - 2;
    score -= garbage * 10;
    if (rafflesia) score -= 50;
    if (flowers >= 3) score += flowers - 2;
    const b = band(score);
    return { a, trees, weeds, junk, garbage, flowers, rafflesia, score, band: b, word: BANDS[b][1], todo: todo({ trees, weeds, junk, garbage, flowers, rafflesia, score }) };
  }
  // The fewest changes that bring an acre to 101 (or keep it there).
  function todo(x) {
    const out = [];
    if (x.rafflesia) out.push('Pick the Rafflesia (−50)');
    if (x.garbage) out.push(`Pick up ${x.garbage} piece${x.garbage === 1 ? '' : 's'} of garbage (−${x.garbage * 10})`);
    if (x.trees < 12) out.push(`Plant ${12 - x.trees} tree${12 - x.trees === 1 ? '' : 's'}`);
    if (x.trees > 15) out.push(`Cut down ${x.trees - 15} tree${x.trees - 15 === 1 ? '' : 's'}`);
    if (x.weeds > 2) out.push(`Pull ${x.weeds - 2} weed${x.weeds - 2 === 1 ? '' : 's'}`);
    if (x.junk > 2) out.push(`Tidy ${x.junk - 2} item${x.junk - 2 === 1 ? '' : 's'} off the ground`);
    if (x.flowers < 3) out.push(`Plant ${3 - x.flowers} flower${3 - x.flowers === 1 ? '' : 's'}`);
    return out;
  }
  const RATING = ['Very poor', 'Needs a lot of work', 'Getting there', 'Nearly perfect', 'Perfect'];
  function town(s) {
    const acres = [...Array(16).keys()].map(a => acre(s, a)), counts = [0, 0, 0, 0, 0];
    acres.forEach(x => counts[x.band]++);
    const rating = counts[0] === 16 ? 0 : counts[0] || counts[1] ? 1 : counts[2] ? 2 : counts[4] < 8 ? 3 : 4;
    return { acres, counts, rating, word: RATING[rating], perfect: rating === 4, excellent: counts[4], needExcellent: Math.max(0, 8 - counts[4]) };
  }
  window.WW_PERFECT = { acre, town, BANDS, RATING };
})();
