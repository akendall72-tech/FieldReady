// Field Ready refuses to run inside another site's frame. A hostile page could otherwise show this
// site invisibly over its own and trick a signed-in owner into clicking ("clickjacking"). GitHub
// Pages can't send the header that forbids framing, so this does it: loaded first, as a classic
// script, it marks a framed page (the page scripts then draw nothing) and shows only a link that
// opens Field Ready on its own. Everything clickable is drawn by script, so nothing else shows.
(function () {
  var framed;
  try {
    framed = window.top !== window.self;
  } catch (error) {
    framed = true;
  }
  if (!framed) return;
  window.fieldReadyFramed = true;
  document.addEventListener("DOMContentLoaded", function () {
    var link = document.createElement("a");
    // Without the part after #: a welcome link's token stays out of anyone else's hands.
    link.href = location.href.split("#")[0];
    link.target = "_top";
    link.rel = "noopener noreferrer";
    link.textContent = "Open Field Ready in its own window";
    var note = document.createElement("p");
    note.className = "loading";
    note.appendChild(link);
    document.body.replaceChildren(note);
  });
})();
