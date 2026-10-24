/**
 * A minimal browser stand-in: keeps cookies, never follows redirects on its own (the
 * redirect target is part of what the tests pin down) and asks for English pages.
 */

export interface Reply {
  status: number;
  location: string | null;
  text: string;
  json<T = any>(): T;
}

export class Client {
  private cookies = new Map<string, string>();

  constructor(readonly baseUrl: string) {}

  private async send(method: string, url: string, body?: BodyInit, contentType?: string): Promise<Reply> {
    const headers: Record<string, string> = { 'Accept-Language': 'en' };
    if (contentType) headers['Content-Type'] = contentType;
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    const response = await fetch(this.baseUrl + url, { method, headers, body: body ?? null, redirect: 'manual' });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const index = pair!.indexOf('=');
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      if (value === '' || /max-age=0|expires=thu, 01 jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      text,
      json: () => JSON.parse(text)
    };
  }

  get(url: string): Promise<Reply> {
    return this.send('GET', url);
  }

  delete(url: string): Promise<Reply> {
    return this.send('DELETE', url);
  }

  /** Posts like an HTML form; arrays repeat the key, as a multi-select would. */
  postForm(url: string, fields: Record<string, string | number | boolean | string[]>): Promise<Reply> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) {
      for (const one of Array.isArray(value) ? value : [value]) params.append(key, String(one));
    }
    return this.send('POST', url, params.toString(), 'application/x-www-form-urlencoded');
  }

  postJson(url: string, data: unknown): Promise<Reply> {
    return this.send('POST', url, JSON.stringify(data), 'application/json');
  }

  postMultipart(url: string, form: FormData): Promise<Reply> {
    return this.send('POST', url, form);
  }
}
