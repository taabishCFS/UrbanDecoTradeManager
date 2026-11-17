import { describe, expect, test } from "vitest";

import {
  cleanEmailReply,
  htmlToText,
  parseEmailAddress,
  replySubject,
} from "../app/services/email-text.server.js";

describe("cleanEmailReply", () => {
  test("removes an 'On ... wrote:' quoted chain", () => {
    const body =
      "Thanks!\n\nOn 13 Aug 2026, at 11:47, Urban Deco wrote:\n> hello there";
    expect(cleanEmailReply(body)).toBe("Thanks!");
  });

  test("removes Original Message sections and > lines", () => {
    const body =
      "Sounds good\n> old quoted line\n\n-----Original Message-----\nFrom: x\nstuff";
    expect(cleanEmailReply(body)).toBe("Sounds good");
  });

  test("removes an Outlook From/Sent/To/Subject block", () => {
    const body =
      "See attached portfolio link\n\nFrom: Urban Deco\nSent: Wednesday\nTo: a@b.com\nSubject: Re: hi\n\nolder text";
    expect(cleanEmailReply(body)).toBe("See attached portfolio link");
  });

  test("keeps text after a line that merely contains 'wrote:' mid-sentence", () => {
    const body =
      "Intro\non the brief Ada wrote: we need X\nMore details follow";
    expect(cleanEmailReply(body)).toBe(body);
  });

  test("keeps text after a short underscore form field", () => {
    const body = "Signature: __________\nPlease see the rest";
    expect(cleanEmailReply(body)).toBe(body);
  });

  test("still strips after a long Outlook underscore separator", () => {
    const body = `Thanks\n\n${"_".repeat(32)}\nFrom: x\nolder text`;
    expect(cleanEmailReply(body)).toBe("Thanks");
  });

  test("returns '(no new text)' when everything is quoted", () => {
    expect(cleanEmailReply("> only quoted\n> more quoted")).toBe(
      "(no new text)"
    );
    expect(cleanEmailReply("")).toBe("(no new text)");
  });
});

describe("parseEmailAddress", () => {
  test("extracts the lowercase address from a display-name header", () => {
    expect(parseEmailAddress('"Ada Smith" <Ada@Example.COM>')).toBe(
      "ada@example.com"
    );
  });

  test("handles a bare address with spaces and capitals", () => {
    expect(parseEmailAddress("  Ada@Example.com ")).toBe("ada@example.com");
  });

  test("returns an empty string for garbage", () => {
    expect(parseEmailAddress("not an email")).toBe("");
    expect(parseEmailAddress(undefined)).toBe("");
  });
});

describe("htmlToText", () => {
  test("turns block tags into line breaks and strips tags and entities", () => {
    const html =
      "<div>Hello <b>Ada</b></div><p>Tom &amp; Jerry&nbsp;said &quot;hi&quot;</p>Line<br>two";
    expect(htmlToText(html)).toBe('Hello Ada\nTom & Jerry said "hi"\nLine\ntwo');
  });
});

describe("replySubject", () => {
  test("adds Re: once and respects an existing prefix", () => {
    expect(replySubject("Test")).toBe("Re: Test");
    expect(replySubject("RE: Test")).toBe("RE: Test");
  });

  test("uses a default for an empty subject", () => {
    expect(replySubject("")).toBe("Re: Your trade application");
    expect(replySubject(undefined)).toBe("Re: Your trade application");
  });
});
