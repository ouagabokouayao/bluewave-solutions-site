const menuButton = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");

if (menuButton && navLinks) {
  const menuLabel = menuButton.querySelector(".sr-only");

  const setMenuState = (isOpen) => {
    navLinks.classList.toggle("is-open", isOpen);
    menuButton.setAttribute("aria-expanded", String(isOpen));
    if (menuLabel) {
      menuLabel.textContent = isOpen ? "Fermer le menu" : "Ouvrir le menu";
    }
  };

  menuButton.addEventListener("click", () => {
    setMenuState(menuButton.getAttribute("aria-expanded") !== "true");
  });

  navLinks.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      setMenuState(false);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
      setMenuState(false);
      menuButton.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (!menuButton.contains(event.target) && !navLinks.contains(event.target)) {
      setMenuState(false);
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) {
      setMenuState(false);
    }
  });
}
