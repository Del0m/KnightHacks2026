import { describe, expect, it } from "vitest";
import { isAbusiveComment } from "../src/services/commentSafety.js";

describe("local comment safety", () => {
  it.each([
    "You're fat adapted for endurance",
    "Your ugly form improved",
    "You're ugly at first, but practice helps",
    "Shut up, that's an amazing PR!",
    "That was a fucking hard set",
    "My form looks like shit today",
  ])("leaves contextual language to AI: %s", (body) => {
    expect(isAbusiveComment(body)).toBe(false);
  });
  it.each([
    "You're stupid",
    "you are worthless",
    "you are disgusting",
    "you are an asshole",
    "go kill yourself",
    "I'll kill you",
    "nigger",
  ])("blocks clear abuse: %s", (body) => {
    expect(isAbusiveComment(body)).toBe(true);
  });
});
