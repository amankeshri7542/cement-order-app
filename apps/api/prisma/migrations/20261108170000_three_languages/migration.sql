-- Plan v4 B2: three languages. 'hi' now means Hindi in Devanagari and 'hinglish' is Hindi in Latin
-- letters. Staff rows (role ADMIN) only ever used 'hi' for Hinglish, the desk's own words, and the
-- desk showed Hinglish to anyone who had not picked English in that browser (the browser's own
-- choice is carried over to the server on its next visit). So every staff row starts on Hinglish.
-- Customer rows keep 'hi': for them it always meant Devanagari, on the website and in messages.
UPDATE "User" SET "language" = 'hinglish' WHERE "role" = 'ADMIN' AND "language" IN ('hi', 'en');
