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

  // Doit rester aligné sur le point de bascule CSS de la navigation (980 px).
  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) {
      setMenuState(false);
    }
  });
}

/* Formulaire de qualification (contact.html).
   Aucun backend : les valeurs saisies servent uniquement à composer un
   courriel ouvert dans le logiciel de messagerie du visiteur, qui reste seul
   à décider de l'envoi. Rien n'est stocké ni transmis par le site. */
const projectForm = document.querySelector("#projet-form");

if (projectForm) {
  const ADDRESS = "bluewavesolutions3399@gmail.com";

  // Valeur lisible d'un champ : le libellé pour une liste, le texte saisi sinon.
  const readField = (name) => {
    const field = projectForm.elements[name];
    if (!field) {
      return "";
    }
    if (field.tagName === "SELECT") {
      const option = field.options[field.selectedIndex];
      return option && option.value ? option.textContent.trim() : "";
    }
    // Les sauts de ligne d'un textarea sont normalisés en CRLF : certains
    // clients mail ignorent un LF isolé dans un corps de mailto:.
    return field.value.trim().replace(/\r?\n/g, "\r\n");
  };

  // Pré-sélection du besoin depuis un lien « Présenter un projet » d'une offre.
  const requested = new URLSearchParams(window.location.search).get("besoin");
  if (requested) {
    const besoin = projectForm.elements.besoin;
    const known = Array.from(besoin.options).some((option) => option.value === requested);
    if (known) {
      besoin.value = requested;
    }
  }

  projectForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const organisation = readField("organisation");
    const territoire = readField("territoire");
    const nom = readField("nom");

    const lines = [
      "Bonjour,",
      "",
      "Je souhaite présenter un projet à BlueWave Solutions.",
      "",
      `Organisation : ${organisation}`,
      `Type de structure : ${readField("structure")}`,
      `Territoire / espace : ${territoire}`,
      `Problématique : ${readField("problematique")}`,
      `Stade du projet : ${readField("stade")}`,
      `Besoin / résultat recherché : ${readField("besoin")}`,
      `Échéance : ${readField("echeance")}`,
      "",
      `Nom : ${nom}`,
      `Fonction : ${readField("fonction")}`,
      `Email : ${readField("email")}`,
      "",
      "Cordialement,",
      nom,
    ];

    const reference = organisation || territoire || nom;
    const subject = reference
      ? `Présentation d'un projet — ${reference}`
      : "Présentation d'un projet";

    const query = new URLSearchParams({ subject, body: lines.join("\r\n") });
    // URLSearchParams encode l'espace en « + », que les clients mail ne
    // réinterprètent pas dans un mailto: ; on rétablit l'encodage attendu.
    window.location.href = `mailto:${ADDRESS}?${query.toString().replace(/\+/g, "%20")}`;
  });
}
