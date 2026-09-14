const NEW_STATUS_RULE = ({ checked, total }) => {
    if (checked === 0) return "À faire";
    if (checked === total) return "Terminé";
    return "En cours";
};

const STATUS_VALUES = ["À faire", "En cours", "En attente", "Terminé"];

const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
};

const fire = el => {
    ["mousedown", "mouseup", "click"].forEach(type =>
        el.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
        }))
    );
};

const all = [...document.querySelectorAll("*")];

const lienDoc = all.find(el => el.textContent?.trim() === "Lien doc");
const comments = all.find(el => el.textContent?.trim() === "Comments");

if (!lienDoc || !comments) throw new Error("Bornes de contenu introuvables");

const topMin = lienDoc.getBoundingClientRect().bottom;
const topMax = comments.getBoundingClientRect().top;

const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
    .filter(cb => {
        if (!visible(cb)) return false;
        const r = cb.getBoundingClientRect();
        return r.top > topMin && r.top < topMax;
    });

const total = checkboxes.length;
const checked = checkboxes.filter(cb => cb.checked).length;

console.log({ total, checked });

if (!total) throw new Error("Aucune checkbox trouvée dans la zone de contenu");

const targetStatus = NEW_STATUS_RULE({ checked, total });

const statusLabel = all.find(el => el.textContent?.trim() === "Status");
if (!statusLabel) throw new Error('Label "Status" introuvable');

const labelRect = statusLabel.getBoundingClientRect();

const currentStatus = all.find(el => {
    const txt = el.textContent?.trim();
    if (!STATUS_VALUES.includes(txt) || !visible(el)) return false;
    const r = el.getBoundingClientRect();
    return Math.abs(r.top - labelRect.top) < 80 && r.left > labelRect.left;
});

if (!currentStatus) throw new Error("Valeur actuelle du status introuvable");

fire(currentStatus);

setTimeout(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
        .find(el => visible(el) && el.textContent?.trim().includes(targetStatus));

    if (!option) throw new Error(`Option "${targetStatus}" introuvable`);

    fire(option);
    console.log(`Status changé vers "${targetStatus}"`);
}, 300);