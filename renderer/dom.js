/**
 * dom.js
 * Safe DOM construction helpers.
 *
 * The previous UI built table rows with template strings and `innerHTML`, and
 * interpolated user-entered UTXO labels straight into inline `onblur="..."`
 * handlers. A label of `'); alert(1);//` executed. This module exists so that
 * no user-controlled value is ever parsed as markup: text goes in through
 * `textContent`, and behaviour is attached with `addEventListener`.
 */

/**
 * Creates an element.
 *
 * @param {string} tag
 * @param {{class?: string, text?: string, attrs?: object, dataset?: object, on?: object}} [spec]
 * @param {Array<Node>} [children]
 * @returns {HTMLElement}
 */
export const el = (tag, spec = {}, children = []) => {
    const node = document.createElement(tag);

    if (spec.class) node.className = spec.class;
    // textContent, never innerHTML: this is the line that closes the injection.
    if (spec.text !== undefined && spec.text !== null) node.textContent = String(spec.text);

    for (const [name, value] of Object.entries(spec.attrs || {})) {
        if (value === false || value === null || value === undefined) continue;
        node.setAttribute(name, value === true ? '' : String(value));
    }

    for (const [name, value] of Object.entries(spec.dataset || {})) {
        node.dataset[name] = String(value);
    }

    for (const [event, handler] of Object.entries(spec.on || {})) {
        node.addEventListener(event, handler);
    }

    for (const child of children) {
        if (child) node.appendChild(child);
    }

    return node;
};

/** Removes every child of a node. */
export const clear = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
};

/** Replaces a node's contents with the supplied children. */
export const replaceChildren = (node, children) => {
    clear(node);
    for (const child of children) {
        if (child) node.appendChild(child);
    }
};

export const byId = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing element #${id}`);
    return node;
};

/** Sets an element's text without touching its markup. */
export const setText = (id, text) => {
    byId(id).textContent = text === null || text === undefined ? '' : String(text);
};

export const setHidden = (id, hidden) => byId(id).classList.toggle('is-hidden', Boolean(hidden));

/** Builds a `<td>`. */
export const cell = (text, className) => el('td', { text, class: className });

/**
 * Builds a text input bound to a change handler. Used instead of
 * `contenteditable`, which pastes arbitrary HTML into the document.
 */
export const editableCell = (value, placeholder, onCommit) => {
    const input = el('input', {
        class: 'cell-input',
        attrs: { type: 'text', value: value || '', placeholder, maxlength: '512', spellcheck: 'false' },
        on: {
            change: (event) => onCommit(event.target.value),
            blur: (event) => onCommit(event.target.value),
        },
    });
    return el('td', {}, [input]);
};

/** Builds a coloured pill. */
export const tag = (text, kind) => el('span', { class: `tag tag--${kind}`, text });
