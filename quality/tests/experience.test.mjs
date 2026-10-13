import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

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
