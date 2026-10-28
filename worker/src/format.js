// "Mon 16 Nov", the same label the app uses
const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const formatDay = (iso) => DAY.format(new Date(iso + "T00:00:00Z"));
