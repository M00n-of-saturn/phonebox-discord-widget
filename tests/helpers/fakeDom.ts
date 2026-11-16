// DOM mínimo para probar el widget sin navegador. Solo implementa lo que el widget puede usar;
// innerHTML, outerHTML e insertAdjacentHTML lanzan para que cualquier uso falle en las pruebas.

type FakeChild = FakeElement | FakeText;

export class FakeText {
  readonly nodeType = 3;
  data: string;
  parent: FakeElement | null = null;

  constructor(data: string) {
    this.data = data;
  }

  get textContent(): string {
    return this.data;
  }
}

class FakeClassList {
  #names = new Set<string>();

  add(...names: string[]): void {
    for (const name of names) this.#names.add(name);
  }

  remove(...names: string[]): void {
    for (const name of names) this.#names.delete(name);
  }

  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.#names.has(name);
    if (on) this.#names.add(name);
    else this.#names.delete(name);
    return on;
  }

  contains(name: string): boolean {
    return this.#names.has(name);
  }

  get value(): string {
    return [...this.#names].join(' ');
  }
}

const forbidden = (name: string) => () => {
  throw new Error(`${name} está prohibido en el widget`);
};

export class FakeElement {
  readonly nodeType = 1;
  readonly tagName: string;
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  children: FakeChild[] = [];
  parent: FakeElement | null = null;
  #attributes = new Map<string, string>();
  #listeners = new Map<string, Array<(event: { type: string; currentTarget: FakeElement }) => void>>();

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get className(): string {
    return this.classList.value;
  }

  set className(value: string) {
    for (const name of this.classList.value.split(' ')) if (name) this.classList.remove(name);
    this.classList.add(...value.split(/\s+/).filter(Boolean));
  }

  get textContent(): string {
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.replaceChildren(String(value));
  }

  get innerHTML(): string {
    return forbidden('innerHTML')();
  }

  set innerHTML(_value: string) {
    forbidden('innerHTML')();
  }

  get outerHTML(): string {
    return forbidden('outerHTML')();
  }

  set outerHTML(_value: string) {
    forbidden('outerHTML')();
  }

  insertAdjacentHTML(): void {
    forbidden('insertAdjacentHTML')();
  }

  append(...nodes: Array<FakeChild | string>): void {
    for (const node of nodes) {
      const child = typeof node === 'string' ? new FakeText(node) : node;
      if (child.parent) child.parent.children = child.parent.children.filter((c) => c !== child);
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: Array<FakeChild | string>): void {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.#attributes.set(name, String(value));
  }

  getAttribute(name: string): string | null {
    return this.#attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.#attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }

  addEventListener(type: string, handler: (event: { type: string; currentTarget: FakeElement }) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(handler);
    this.#listeners.set(type, list);
  }

  click(): void {
    for (const handler of this.#listeners.get('click') ?? []) handler({ type: 'click', currentTarget: this });
  }

  /** Acepta `.clase` o un nombre de etiqueta. */
  querySelectorAll(selector: string): FakeElement[] {
    const match = selector.startsWith('.')
      ? (el: FakeElement) => el.classList.contains(selector.slice(1))
      : (el: FakeElement) => el.tagName === selector.toUpperCase();
    const found: FakeElement[] = [];
    const walk = (el: FakeElement) => {
      for (const child of el.children) {
        if (child instanceof FakeElement) {
          if (match(child)) found.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createTextNode(data: string): FakeText {
    return new FakeText(data);
  }
}

/** Atajo para pasar el DOM falso donde se espera uno real. */
export function fakeDom(): { doc: Document; root: HTMLElement; fakeRoot: FakeElement } {
  const fakeDoc = new FakeDocument();
  const fakeRoot = fakeDoc.createElement('div');
  return { doc: fakeDoc as unknown as Document, root: fakeRoot as unknown as HTMLElement, fakeRoot };
}
