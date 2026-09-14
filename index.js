(() => {
    const EXPECTED_DATABASE_NAME = "Tâches";

    const NEW_STATUS_RULE = ({ checked, total }) => {
        if (checked === 0) return "À faire";
        if (checked === total) return "Terminé";
        return "En cours";
    };

    const STATUS_VALUES = ["À faire", "En cours", "En attente", "Terminé"];

    // À augmenter si tu coches très vite ou si Notion est lent.
    const SYNC_DEBOUNCE_MS = 900;

    // Deux lectures identiques d'affilée = l'UI Notion est considérée stable.
    const SETTLE_DELAY_MS = 150;
    const SETTLE_MAX_ATTEMPTS = 12;

    const SCRIPT_KEY = "__notionTaskStatusSync";

    // Si tu colles le script une seconde fois, on retire l'ancien listener :
    // pas de doubles mises à jour ni de timers fantômes.
    if (window[SCRIPT_KEY]?.onInteraction) {
        document.removeEventListener(
            "click",
            window[SCRIPT_KEY].onInteraction,
            true
        );
    }

    if (window[SCRIPT_KEY]?.syncTimer) {
        clearTimeout(window[SCRIPT_KEY].syncTimer);
    }

    const state = {
        syncTimer: null,
        generation: 0,
        onInteraction: null
    };

    window[SCRIPT_KEY] = state;

    const normalize = value =>
        (value || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

    const visible = el => {
        if (!el) return false;

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
        );
    };

    const fire = el => {
        const rect = el.getBoundingClientRect();

        const init = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
        };

        [
            "pointerover",
            "mouseover",
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click"
        ].forEach(type => {
            el.dispatchEvent(new MouseEvent(type, init));
        });
    };

    // --- Ta détection de checkboxes : conservée ---
    const getCheckboxes = () => {
        const all = [...document.querySelectorAll("*")];

        const lienDoc = all.find(
            el => normalize(el.textContent) === "Lien doc"
        );

        const comments = all.find(
            el => normalize(el.textContent) === "Comments"
        );

        if (!lienDoc || !comments) {
            throw new Error("Bornes de contenu introuvables");
        }

        const topMin = lienDoc.getBoundingClientRect().bottom;
        const topMax = comments.getBoundingClientRect().top;

        return [...document.querySelectorAll('input[type="checkbox"]')]
            .filter(cb => {
                if (!visible(cb)) return false;

                const rect = cb.getBoundingClientRect();
                return rect.top > topMin && rect.top < topMax;
            });
    };

    const getCounts = () => {
        const checkboxes = getCheckboxes();

        return {
            total: checkboxes.length,
            checked: checkboxes.filter(cb => cb.checked).length
        };
    };

    // Protection de contexte : vérifie simplement que la page expose les champs
    // caractéristiques d'une tâche de la base « Tâches ».
    const isTaskPage = () => {
        const text = normalize(document.body.innerText);

        return (
            text.includes("Status") &&
            text.includes("Lien doc") &&
            text.includes("Comments") &&
            (
                text.includes(EXPECTED_DATABASE_NAME) ||
                document.title.includes("Tâche")
            )
        );
    };

    const getStatusButton = () => {
        const all = [...document.querySelectorAll("*")];

        const statusLabel = all.find(
            el => normalize(el.textContent) === "Status"
        );

        if (!statusLabel) return null;

        const labelRect = statusLabel.getBoundingClientRect();

        const candidates = [
            ...document.querySelectorAll(
                '[role="button"][data-testid="property-value"]'
            )
        ]
            .filter(visible)
            .filter(el => STATUS_VALUES.includes(normalize(el.textContent)))
            .filter(el => {
                const rect = el.getBoundingClientRect();

                return (
                    Math.abs(rect.top - labelRect.top) < 90 &&
                    rect.left >= labelRect.left
                );
            })
            .sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();

                return ar.left - br.left || ar.top - br.top;
            });

        // Si Notion n'expose pas le wrapper « property-value », reprendre la valeur
        // visible située près du libellé Status, sans toucher aux checkboxes.
        if (candidates[0]) return candidates[0];

        return all
            .filter(visible)
            .filter(el => STATUS_VALUES.includes(normalize(el.textContent)))
            .filter(el => {
                const rect = el.getBoundingClientRect();

                return (
                    rect.top >= labelRect.top - 10 &&
                    rect.top <= labelRect.bottom + 90 &&
                    rect.left >= labelRect.left
                );
            })
            .sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();

                const aDistance =
                    Math.abs(ar.top - labelRect.bottom) +
                    Math.abs(ar.left - labelRect.left);

                const bDistance =
                    Math.abs(br.top - labelRect.bottom) +
                    Math.abs(br.left - labelRect.left);

                return aDistance - bDistance;
            })[0] || null;
    };

    const getOpenStatusOption = target => {
        return [
            ...document.querySelectorAll('[role="option"], option')
        ]
            .filter(visible)
            .find(el => normalize(el.textContent) === target) || null;
    };

    const waitForStableCheckboxes = (
        generation,
        onStable,
        attempts = SETTLE_MAX_ATTEMPTS
    ) => {
        let previousSignature = null;
        let equalReads = 0;

        const readAgain = () => {
            // Une action plus récente existe : cette synchro est abandonnée.
            if (generation !== state.generation) return;

            const counts = getCounts();
            const signature = `${counts.checked}/${counts.total}`;

            if (signature === previousSignature) {
                equalReads += 1;
            } else {
                previousSignature = signature;
                equalReads = 0;
            }

            if (equalReads >= 1 || attempts <= 0) {
                onStable(counts, generation);
                return;
            }

            attempts -= 1;
            setTimeout(readAgain, SETTLE_DELAY_MS);
        };

        setTimeout(readAgain, SETTLE_DELAY_MS);
    };

    const setStatus = (target, generation) => {
        // Si un nouveau clic est intervenu, ne pas modifier le status.
        if (generation !== state.generation) return;

        const button = getStatusButton();

        if (!button) {
            console.warn("Bouton du Status introuvable");
            return;
        }

        const current = normalize(button.textContent);

        if (current === target) {
            console.log(`Status déjà correct : ${target}`);
            return;
        }

        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        fire(button);

        const findOption = (remaining = 40) => {
            // Une nouvelle rafale a démarré pendant l'ouverture du menu.
            if (generation !== state.generation) {
                window.scrollTo(scrollX, scrollY);
                return;
            }

            const option = getOpenStatusOption(target);

            if (option) {
                fire(option);

                requestAnimationFrame(() => {
                    window.scrollTo(scrollX, scrollY);
                });

                console.log(`Status changé vers "${target}"`);
                return;
            }

            if (remaining <= 0) {
                window.scrollTo(scrollX, scrollY);
                console.warn(`Option "${target}" introuvable`);
                return;
            }

            setTimeout(() => findOption(remaining - 1), 120);
        };

        setTimeout(() => findOption(), 250);
    };

    const syncStatusNow = generation => {
        if (generation !== state.generation) return;

        waitForStableCheckboxes(generation, ({ total, checked }) => {
            if (generation !== state.generation) return;

            if (!total) {
                console.warn("Aucune checkbox trouvée dans le contenu");
                return;
            }

            const target = NEW_STATUS_RULE({ checked, total });

            console.log({
                total,
                checked,
                target,
                generation
            });

            setStatus(target, generation);
        });
    };

    const scheduleSync = () => {
        // Invalide immédiatement les anciennes attentes et sélections de status.
        state.generation += 1;
        const generation = state.generation;

        if (state.syncTimer) {
            clearTimeout(state.syncTimer);
        }

        state.syncTimer = setTimeout(() => {
            state.syncTimer = null;
            syncStatusNow(generation);
        }, SYNC_DEBOUNCE_MS);

        console.log(`Status planifié dans ${SYNC_DEBOUNCE_MS} ms — séquence ${generation}`);
    };

    state.onInteraction = event => {
        const checkbox = event.target?.closest?.('input[type="checkbox"]');
        if (!checkbox) return;

        let trackedCheckboxes;

        try {
            trackedCheckboxes = getCheckboxes();
        } catch {
            return;
        }

        if (!trackedCheckboxes.includes(checkbox)) return;

        scheduleSync();
    };

    if (!isTaskPage()) {
        console.warn(
            `Script non activé : cette page ne semble pas être un élément de la base « ${EXPECTED_DATABASE_NAME} ».`
        );
        return;
    }

    // Un seul événement est volontairement utilisé : plus de double déclenchement
    // pointerup/mouseup/click pour une même action.
    document.addEventListener("click", state.onInteraction, true);

    window.syncTaskStatus = () => {
        state.generation += 1;
        syncStatusNow(state.generation);
    };

    console.log(
        `Prêt : ${getCheckboxes().length} checkboxes suivies — ` +
        `base détectée : ${EXPECTED_DATABASE_NAME} — ` +
        `debounce : ${SYNC_DEBOUNCE_MS} ms`
    );
})();