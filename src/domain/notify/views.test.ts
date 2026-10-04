import test from "node:test";
import assert from "node:assert/strict";
import { diffView } from "./views.js";

const i = (id: string, type = "started") => ({ id, identifier: id, title: id, url: "", state: { name: type, type } });

test("diffView：首次只建基线，不通知", () => {
  const d = diffView(null, [i("a"), i("b", "completed")]);
  assert.deepEqual([d.added, d.completed], [[], []]);
  assert.deepEqual(d.snapshot, { a: false, b: true });
});

test("diffView：新进入与新完成", () => {
  const prev = { a: false, b: false };
  const d = diffView(prev, [i("a", "completed"), i("b"), i("c")]);
  assert.deepEqual(d.added.map((x) => x.id), ["c"]);
  assert.deepEqual(d.completed.map((x) => x.id), ["a"]);
});

test("diffView：已完成的不会重复通知，离开视图的忽略", () => {
  const d = diffView({ a: true, gone: false }, [i("a", "completed")]);
  assert.deepEqual([d.added, d.completed], [[], []]);
  assert.deepEqual(d.snapshot, { a: true });
});
