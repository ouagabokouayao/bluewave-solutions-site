import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';

const source = readFileSync(new URL('../../assets/js/experience.js', import.meta.url), 'utf8');
function element(dataset = {}) {
  const handlers = {}, attrs = {}, classes = new Set();
  return {dataset, hidden: true, textContent: '', attrs, handlers,
    setAttribute(key, value) {attrs[key] = value;}, getAttribute(key) {return attrs[key];},
    addEventListener(key, fn) {handlers[key] = fn;}, focus() {this.focused = true;},
    classList: {remove(key) {classes.delete(key);}, toggle(key, value) {value ? classes.add(key) : classes.delete(key);}, contains(key) {return classes.has(key);}}};
}
function setup({reduce = false, present = true} = {}) {
  const root = element(), menu = element(), panel = element(), header = element(), motion = element(), description = element();
  const buttons = ['1','2','3'].map(usage => element({usage}));
  const reduced = {matches: reduce, addEventListener(_, fn) {this.change = fn;}};
  const desktop = {matches: false, addEventListener(_, fn) {this.change = fn;}};
  const doc = {handlers: {}, querySelector(selector) {return ({'.home-premium': present ? root : null, '.menu-toggle': menu, '.topbar': header, '[data-motion-toggle]': motion, '[data-matrix-description]': description})[selector];}, getElementById() {return panel;}, querySelectorAll() {return buttons;}, addEventListener(key, fn) {this.handlers[key] = fn;}};
  const win = {scrollY: 0, handlers: {}, matchMedia(query) {return query.includes('reduced') ? reduced : desktop;}, addEventListener(key, fn) {this.handlers[key] = fn;}, requestAnimationFrame(fn) {fn();}};
  runInNewContext(source, {document: doc, window: win});
  return {root, menu, panel, header, motion, description, buttons, reduced, desktop, doc, win};
}
test('mobile navigation opens, closes on a link, Escape restores focus', () => {
  const x = setup(); assert.equal(x.panel.hidden, true); assert.equal(x.menu.hidden, false);
  x.menu.handlers.click(); assert.equal(x.panel.hidden, false); assert.equal(x.menu.attrs['aria-expanded'], 'true');
  assert.equal(x.root.classList.contains('menu-open'), true);
  x.panel.handlers.click({target: {closest: () => ({})}}); assert.equal(x.panel.hidden, true);
  x.menu.handlers.click(); x.doc.handlers.keydown({key: 'Escape'});
  assert.equal(x.panel.hidden, true); assert.equal(x.menu.focused, true);
});
test('returning to desktop closes the mobile overlay', () => {
  const x=setup(); x.menu.handlers.click(); x.desktop.change({matches: true});
  assert.equal(x.panel.hidden,true); assert.equal(x.root.classList.contains('menu-open'),false);
});
test('animations pause and respect changes to reduced motion', () => {
  const x=setup(); assert.equal(x.motion.hidden,false); x.motion.handlers.click();
  assert.equal(x.root.dataset.motionPaused,'true'); assert.equal(x.motion.attrs['aria-pressed'],'true');
  x.motion.handlers.click(); assert.equal(x.root.dataset.motionPaused,'false');
  x.reduced.matches=true; x.reduced.change(); assert.equal(x.root.dataset.motionPaused,'true'); assert.equal(x.motion.hidden,true);
  const initial=setup({reduce:true}); assert.equal(initial.root.dataset.motionPaused,'true'); assert.equal(initial.motion.hidden,true);
});
test('matrix selection changes the explanatory text and selected state', () => {
  const x=setup(); x.buttons[1].handlers.click(); assert.match(x.description.textContent,/acteur B/);
  assert.deepEqual(x.buttons.map(b=>b.attrs['aria-pressed']), ['false','true','false']);
  x.buttons[2].handlers.click(); assert.match(x.description.textContent,/restent à documenter/);
});
test('home enhancement has no effect on other pages', () => {const x=setup({present:false}); assert.equal(x.menu.handlers.click,undefined);});
test('sticky header changes at the scroll threshold', () => {
  const x=setup(); assert.equal(x.header.classList.contains('scrolled'),false);
  x.win.scrollY=75; x.win.handlers.scroll(); assert.equal(x.header.classList.contains('scrolled'),true);
  x.win.scrollY=0; x.win.handlers.scroll(); assert.equal(x.header.classList.contains('scrolled'),false);
});

const home = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const approvedHome = execFileSync('git', ['show', '6333ccbd23ee4043232758c73a5dc433ab4d5379:index.html'], {cwd: new URL('../..', import.meta.url), encoding: 'utf8'});
test('the seven situations retain every text, link and preselection', () => {
  const cards = html => html.match(/<article class="problem-card">[\s\S]*?<\/article>/g) || [];
  assert.equal(cards(home).length, 7);
  assert.deepEqual(cards(home), cards(approvedHome));
});
test('situations use a closed native disclosure with its approved label', () => {
  const details = home.match(/<details\b([^>]*)>([\s\S]*?)<\/details>/);
  assert.ok(details);
  assert.doesNotMatch(details[1], /\bopen\b/);
  assert.match(details[2], /^<summary>Vous partez d’une situation concrète \?<\/summary>/);
  assert.equal((details[2].match(/class="problem-card"/g) || []).length, 7);
});
test('the compact proof strip retains all three original contents and destinations', () => {
  const before = approvedHome.match(/<article class="proof-card">[\s\S]*?<\/article>/g) || [];
  const after = home.match(/<article class="proof-strip-item">[\s\S]*?<\/article>/g) || [];
  assert.equal(after.length, 3);
  assert.deepEqual(after, before.map(card => card.replace('class="proof-card"', 'class="proof-strip-item"')));
});
test('hero actions qualify first and reveal the offers, with method still in both menus', () => {
  const actions = home.match(/<div class="hero-actions">([\s\S]*?)<\/div>/)[1];
  assert.match(actions, /class="btn btn-primary" href="qualifier-un-besoin\.html">Qualifier un besoin/);
  assert.match(actions, /class="btn btn-glass" href="#expertises">Découvrir les offres/);
  for (const mode of ['desktop', 'mobile']) {
    const nav = home.match(new RegExp('<nav class="' + mode + '-nav"[\\s\\S]*?<\\/nav>'))[0];
    assert.match(nav, /href="methode\.html"/);
  }
});
