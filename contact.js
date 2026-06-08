/* ============================================================
   contact form handler — preetham.org
   ------------------------------------------------------------
   mintlify auto-includes every .js file in the content dir on
   every page, and the site is a client-side spa, so we:
     1. mount the <textarea> ourselves (mintlify's mdx sanitizer
        strips <textarea>, so contact.mdx ships an empty mount
        div #pk-message-mount that we fill here), and
     2. use a delegated submit listener on `document` rather than
        binding to the form on load (the form may mount after a
        client-side navigation).

   the endpoint is read from the form's `data-endpoint` attribute
   (see contact.mdx) so it can be configured without touching this
   file.
   ============================================================ */

(function () {
  "use strict";

  var FALLBACK_ENDPOINT = "https://trifecta.belweave.com/api/contact";

  function setStatus(el, state, msg) {
    if (!el) return;
    el.setAttribute("data-state", state);
    el.textContent = msg;
  }

  // ---- mount the textarea (idempotent; safe to call repeatedly) ----
  function mountTextarea() {
    var mount = document.getElementById("pk-message-mount");
    if (!mount) return;
    if (mount.querySelector("textarea")) return;
    var ta = document.createElement("textarea");
    ta.id = "pk-message";
    ta.name = "message";
    ta.className = "pk-textarea";
    ta.rows = 6;
    ta.placeholder = "what's on your mind?";
    ta.required = true;
    mount.appendChild(ta);
  }

  // run now, on dom ready, and whenever the spa swaps the page in.
  mountTextarea();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountTextarea);
  }
  if (typeof MutationObserver !== "undefined") {
    var obs = new MutationObserver(function () {
      mountTextarea();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---- submit handling (delegated) ----
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.id !== "pk-contact-form") return;

    event.preventDefault();

    var status = form.querySelector("#pk-contact-status");
    var button = form.querySelector("button[type='submit']");
    var endpoint = form.getAttribute("data-endpoint") || FALLBACK_ENDPOINT;

    var data = new FormData(form);
    var name = (data.get("name") || "").toString().trim();
    var email = (data.get("email") || "").toString().trim();
    var message = (data.get("message") || "").toString().trim();
    var company = (data.get("company") || "").toString().trim(); // honeypot

    if (!name || !email || !message) {
      setStatus(status, "err", "please fill in name, email, and message.");
      return;
    }

    var payload = {
      name: name,
      email: email,
      message: message,
      company: company, // honeypot — relay rejects if non-empty
      source: "preetham.org/contact",
    };

    if (button) button.disabled = true;
    setStatus(status, "loading", "sending…");

    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("http " + res.status);
        setStatus(status, "ok", "message sent — thanks, i'll get back to you.");
        form.reset();
      })
      .catch(function (err) {
        setStatus(
          status,
          "err",
          "couldn't send right now. email kyanam.preetham@gmail.com instead."
        );
        // eslint-disable-next-line no-console
        console.error("[contact] submit failed:", err);
      })
      .finally(function () {
        if (button) button.disabled = false;
      });
  });
})();
