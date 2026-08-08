import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeEvent {
  headers: Headers;
  requestUrl: string;
  responseHeaders: Record<string, string>;
}

type Handler = (event: FakeEvent) => Promise<unknown>;

let handler: Handler;
const getSession = vi.fn();
const sendRedirect = vi.fn(
  (_event: FakeEvent, location: string, statusCode: number) => ({
    location,
    statusCode,
  }),
);

beforeAll(async () => {
  vi.stubGlobal("defineEventHandler", (value: Handler) => value);
  vi.stubGlobal("getRequestHeader", (event: FakeEvent, name: string) =>
    event.headers.get(name),
  );
  vi.stubGlobal("getRequestURL", (event: FakeEvent) =>
    new URL(event.requestUrl),
  );
  vi.stubGlobal(
    "setResponseHeaders",
    (event: FakeEvent, headers: Record<string, string>) => {
      Object.assign(event.responseHeaders, headers);
    },
  );
  vi.stubGlobal("sendRedirect", sendRedirect);
  vi.stubGlobal("auth", { api: { getSession } });

  handler = (await import("../../server/middleware/marketing-redirect")).default;
});

beforeEach(() => {
  getSession.mockReset();
  sendRedirect.mockClear();
});

function makeEvent(
  path: string,
  host = "app.reqcore.com",
): FakeEvent {
  return {
    headers: new Headers({ host, cookie: "better-auth.session_token=test" }),
    requestUrl: `https://${host}${path}`,
    responseHeaders: {},
  };
}

describe("app marketing redirects", () => {
  it("sends authenticated pricing visitors to billing", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    const event = makeEvent("/pricing?plan=team&billing=annual");

    await handler(event);

    expect(getSession).toHaveBeenCalledWith({ headers: event.headers });
    expect(sendRedirect).toHaveBeenCalledWith(
      event,
      "/dashboard/settings/billing?plan=team&billing=annual",
      302,
    );
    expect(event.responseHeaders).toEqual({
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    });
  });

  it("sends unauthenticated pricing visitors to the marketing site", async () => {
    getSession.mockResolvedValue(null);
    const event = makeEvent("/pricing?ref=homepage");

    await handler(event);

    expect(sendRedirect).toHaveBeenCalledWith(
      event,
      "https://reqcore.com/pricing?ref=homepage",
      302,
    );
  });

  it("preserves the locale for localized pricing routes", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    const event = makeEvent("/nb/pricing");

    await handler(event);

    expect(sendRedirect).toHaveBeenCalledWith(
      event,
      "/nb/dashboard/settings/billing",
      302,
    );
  });

  it("keeps the home-page canonical redirect permanent", async () => {
    const event = makeEvent("/?ref=legacy");

    await handler(event);

    expect(getSession).not.toHaveBeenCalled();
    expect(sendRedirect).toHaveBeenCalledWith(
      event,
      "https://reqcore.com/?ref=legacy",
      301,
    );
  });

  it("does nothing on non-production app hosts", async () => {
    const event = makeEvent("/pricing", "localhost:3000");

    await handler(event);

    expect(getSession).not.toHaveBeenCalled();
    expect(sendRedirect).not.toHaveBeenCalled();
  });
});
