# Critic calibration examples

`lib/ai/critic.ts` sends up to 3 of these with every scoring call, so its
1-10 scale matches ours. Empty = the critic scores without examples.

One example = a JSON file plus its image, side by side:

```json
{
  "image": "snitch-chinos-launch.jpg",
  "hook": "Olive, finally.",
  "caption": "The straight fit chinos are here...",
  "scores": {
    "stops_scroll": 8,
    "speaks_to_buyer": 7,
    "one_message": 9,
    "image_copy_agree": 9,
    "craft": 8,
    "real_indian": 7,
    "reason_to_act": 6
  },
  "note": "a strong launch post -- what an 8 looks like"
}
```

`image` is a file name in this folder or an https URL. Files are read in name
order; the first 3 with an image and scores are used. Pick a spread (one
great, one ordinary, one weak) rather than three good ones.
