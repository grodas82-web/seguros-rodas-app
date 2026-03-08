// test_timestamp.js
class Timestamp {
    constructor(seconds, nanoseconds) {
        this.seconds = seconds;
        this.nanoseconds = nanoseconds;
    }
    toDate() { return new Date(this.seconds * 1000); }
}

const sanitizeFirestoreData = (obj) => {
    if (obj === undefined) return null;
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sanitizeFirestoreData).filter(v => v !== undefined);

    const newObj = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            newObj[key] = sanitizeFirestoreData(value);
        }
    }
    return newObj;
};

const ts = new Timestamp(12345, 67890);
const clean = sanitizeFirestoreData(ts);

console.log("Original:", ts);
console.log("Cleaned:", clean);
console.log("Is Cleaned a Timestamp instance?", clean instanceof Timestamp);
console.log("Does toDate exist?", typeof clean.toDate === 'function');
