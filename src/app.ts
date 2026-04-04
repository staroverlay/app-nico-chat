import tmi from "@staroverlay/sdk/tmi";
import StarOverlay, { createChatParser, MessageToken } from "@staroverlay/sdk";

const container = document.querySelector<HTMLDivElement>('#app')!;
const messageHistory: HTMLDivElement[] = [];
const userCooldowns = new Map<string, number>();

const recentYPositions: number[] = [];
const MIN_DISTANCE = 50;
const MARGIN_TOP = 20;
const MARGIN_BOTTOM = 20;
const MAX_TRIES = 100;

function getSettings() {
    const s = StarOverlay.settings || {};
    return {
        maxMessages: (s.global?.maxMessages ?? 30) as number,
        maxMessageLength: (s.global?.maxMessageLength ?? 0) as number,
        scrollDuration: (s.global?.scrollDuration ?? 10) as number,
        direction: (s.global?.direction ?? "rtl") as "rtl" | "ltr",
        userCooldown: (s.global?.userCooldown ?? 0) as number,
        allowedUsers: (s.global?.allowedUsers ?? "all") as "all" | "subs" | "vips" | "mods",
        exclude: (s.global?.exclude ?? "") as string,
        textColor: (s.appearance?.messageTextColor ?? "#ffffff") as string,
        fontSize: (s.appearance?.fontSize ?? 24) as number,
        fontFamily: (s.appearance?.fontFamily ?? "Arial") as string,
        channelEmotes: (s.emotes?.channelEmotes ?? true) as boolean,
        ffz: (s.emotes?.ffz ?? true) as boolean,
        bttv: (s.emotes?.bttv ?? true) as boolean,
        seventv: (s.emotes?.seventv ?? true) as boolean,
    };
}

function getRandomY(): number {
    const maxY = window.innerHeight - MARGIN_BOTTOM - 30;
    const minY = MARGIN_TOP;

    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        const randomY = Math.random() * (maxY - minY) + minY;
        const isFarEnough = recentYPositions.every(prevY => Math.abs(randomY - prevY) >= MIN_DISTANCE);
        if (isFarEnough) {
            recentYPositions.push(randomY);
            if (recentYPositions.length > 5) recentYPositions.shift();
            return randomY;
        }
    }

    const fallbackY = Math.random() * (maxY - minY) + minY;
    recentYPositions.push(fallbackY);
    if (recentYPositions.length > 5) recentYPositions.shift();
    return fallbackY;
}

function spawnMessage(author: string, authorColor: string | undefined, messageTokens: MessageToken[]) {
    const cfg = getSettings();

    if (messageHistory.length >= cfg.maxMessages) {
        messageHistory.shift()?.remove();
    }

    const element = document.createElement("div");
    const usernameEl = document.createElement("span");
    const messageEl = document.createElement("span");

    // Apply font settings per message so live updates are reflected
    element.style.fontFamily = cfg.fontFamily;
    element.style.fontSize = `${cfg.fontSize}px`;

    usernameEl.innerText = `${author}:`;
    usernameEl.classList.add("message-username");
    usernameEl.style.color = authorColor || cfg.textColor;

    for (const token of messageTokens) {
        if (token.type === "text") {
            const span = document.createElement("span");
            span.innerText = token.text;
            span.classList.add("message-token-text");
            span.style.color = cfg.textColor;
            messageEl.appendChild(span);
        } else if (token.type === "emote") {
            const img = document.createElement("img");
            const urls = token.emote.url;
            img.src = urls.high || urls.mid || urls.low;
            img.classList.add("message-token-emote");
            messageEl.appendChild(img);
        }
    }

    messageEl.classList.add("message-content");
    element.classList.add("message");
    element.appendChild(usernameEl);
    element.appendChild(messageEl);

    const randomY = getRandomY();
    element.style.top = `${randomY}px`;
    element.style.transition = `transform ${cfg.scrollDuration}s linear`;

    // Direction: RTL starts at right (translateX(100%)), LTR starts at left (-100%)
    if (cfg.direction === "rtl") {
        element.style.left = "100vw";
        element.style.right = "auto";
    } else {
        element.style.left = "auto";
        element.style.right = "100vw";
    }

    container.appendChild(element);
    messageHistory.push(element);

    requestAnimationFrame(() => {
        element.style.transform = cfg.direction === "rtl"
            ? "translateX(calc(-100vw - 100%))"
            : "translateX(calc(100vw + 100%))";
    });

    element.addEventListener('transitionend', () => {
        element.remove();
        const index = messageHistory.indexOf(element);
        if (index > -1) messageHistory.splice(index, 1);
    });
}

function isUserAllowed(state: tmi.ChatUserstate, allowedUsers: string): boolean {
    if (allowedUsers === "all") return true;
    if (allowedUsers === "mods") return state.mod === true || state.badges?.broadcaster === "1";
    if (allowedUsers === "vips") return !!(state.badges?.vip || state.badges?.broadcaster === "1" || state.mod);
    if (allowedUsers === "subs") return state.subscriber === true || state.badges?.broadcaster === "1";
    return true;
}

function initializeApp() {
    const twitchIntegration = StarOverlay.integrations.find(i => i.type === 'twitch');
    if (!twitchIntegration?.username) return;

    const channel = twitchIntegration.username;
    const cfg = getSettings();

    const chatParser = createChatParser(twitchIntegration);
    chatParser.fetchEmotes({
        channel: cfg.channelEmotes,
        ffz: cfg.ffz,
        bttv: cfg.bttv,
        seventv: cfg.seventv,
    }).catch(() => { });

    const client = new tmi.Client({
        channels: [channel],
        connection: { secure: true, reconnect: true },
    });

    client.on("message", (_channel, state, message) => {
        const cfg = getSettings();
        const username = (state["display-name"] || state.username || "<unknown>").toLowerCase();

        // Exclude list
        const excluded = cfg.exclude.split(',').map(u => u.trim().toLowerCase()).filter(Boolean);
        if (excluded.includes(username)) return;

        // Allowed users filter
        if (!isUserAllowed(state, cfg.allowedUsers)) return;

        // Per-user cooldown
        if (cfg.userCooldown > 0) {
            const lastTime = userCooldowns.get(username) ?? 0;
            const now = Date.now();
            if (now - lastTime < cfg.userCooldown) return;
            userCooldowns.set(username, now);
        }

        // Max message length
        let text = message;
        if (cfg.maxMessageLength > 0 && text.length > cfg.maxMessageLength) {
            text = text.slice(0, cfg.maxMessageLength) + "…";
        }

        const tokens = chatParser.parseMessage(text, state.emotes);
        spawnMessage(state["display-name"] || username, state.color, tokens);
    });

    client.connect().catch(() => { });
}

StarOverlay.on("ready", () => {
    initializeApp();
});
