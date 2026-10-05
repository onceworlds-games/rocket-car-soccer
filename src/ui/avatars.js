// Player faces: the platform gives a picture address for anyone's id (or null outside the platform). This only remembers
// the answers; the interface draws them in an <img> with a letter as the fallback.

export function makeAvatars(ow) {
  const map = new Map();
  return {
    /** The address of this player's head picture, or null while it loads or when there is none. */
    url(id) {
      let e = map.get(id);
      if (!e) {
        e = { url: null };
        map.set(id, e);
        try {
          Promise.resolve(ow.player.avatarUrl(id, 'head'))
            .then((u) => {
              e.url = typeof u === 'string' && u ? u : null;
            })
            .catch(() => {});
        } catch (err) {
          // no avatars here: the letter stands in
        }
      }
      return e.url;
    },
  };
}
