// helpers/convertToISOTime.js

/**
 * Converts a 12-hour time string (e.g., "3:34 PM") to an ISO date string.
 * Uses the current date.
 * 
 * @param {string} timeString - Time in "h:mm AM/PM" format
 * @returns {string} ISO date string
 */
export function convertToISOTime(timeString) {
  const today = new Date();
  const [time, modifier] = timeString.trim().split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (modifier === "PM" && hours !== 12) {
    hours += 12;
  } else if (modifier === "AM" && hours === 12) {
    hours = 0;
  }

  const dateWithTime = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    hours,
    minutes,
    0
  );

  return dateWithTime.toISOString();
}
