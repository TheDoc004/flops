/** Shared gym catalog: seeded exercises plus duration-session activity types. */

const GYM_EXERCISES = [
  // Push — Chest
  ['Barbell Bench Press', 'chest', '["triceps","shoulders"]', 'push', 'barbell'],
  ['Incline Barbell Press', 'chest', '["triceps","shoulders"]', 'push', 'barbell'],
  ['Dumbbell Bench Press', 'chest', '["triceps","shoulders"]', 'push', 'dumbbell'],
  ['Incline Dumbbell Press', 'chest', '["triceps","shoulders"]', 'push', 'dumbbell'],
  ['Dumbbell Chest Fly', 'chest', '["shoulders"]', 'push', 'dumbbell'],
  ['Cable Chest Fly', 'chest', '["shoulders"]', 'push', 'cable'],
  ['Push-up', 'chest', '["triceps","shoulders"]', 'push', 'bodyweight'],
  ['Machine Chest Press', 'chest', '["triceps","shoulders"]', 'push', 'machine'],
  // Push — Shoulders
  ['Overhead Press', 'shoulders', '["triceps"]', 'push', 'barbell'],
  ['Dumbbell Shoulder Press', 'shoulders', '["triceps"]', 'push', 'dumbbell'],
  ['Lateral Raise', 'shoulders', '[]', 'push', 'dumbbell'],
  ['Front Raise', 'shoulders', '[]', 'push', 'dumbbell'],
  // Push — Triceps
  ['Tricep Pushdown', 'triceps', '[]', 'push', 'cable'],
  ['Skull Crusher', 'triceps', '[]', 'push', 'barbell'],
  ['Overhead Tricep Extension', 'triceps', '[]', 'push', 'dumbbell'],
  ['Dips', 'triceps', '["chest","shoulders"]', 'push', 'bodyweight'],
  // Pull — Back
  ['Deadlift', 'back', '["glutes","hamstrings"]', 'pull', 'barbell'],
  ['Barbell Row', 'back', '["biceps"]', 'pull', 'barbell'],
  ['Dumbbell Row', 'back', '["biceps"]', 'pull', 'dumbbell'],
  ['T-Bar Row', 'back', '["biceps"]', 'pull', 'barbell'],
  ['Lat Pulldown', 'back', '["biceps"]', 'pull', 'cable'],
  ['Seated Cable Row', 'back', '["biceps"]', 'pull', 'cable'],
  ['Pull-up', 'back', '["biceps"]', 'pull', 'bodyweight'],
  ['Chin-up', 'back', '["biceps"]', 'pull', 'bodyweight'],
  ['Face Pull', 'shoulders', '["back"]', 'pull', 'cable'],
  // Pull — Biceps
  ['Barbell Curl', 'biceps', '["forearms"]', 'pull', 'barbell'],
  ['Dumbbell Curl', 'biceps', '["forearms"]', 'pull', 'dumbbell'],
  ['Hammer Curl', 'biceps', '["forearms"]', 'pull', 'dumbbell'],
  ['Preacher Curl', 'biceps', '[]', 'pull', 'barbell'],
  ['Cable Curl', 'biceps', '[]', 'pull', 'cable'],
  // Legs — Quads
  ['Barbell Back Squat', 'quads', '["glutes","hamstrings"]', 'legs', 'barbell'],
  ['Front Squat', 'quads', '["glutes"]', 'legs', 'barbell'],
  ['Goblet Squat', 'quads', '["glutes"]', 'legs', 'dumbbell'],
  ['Leg Press', 'quads', '["glutes","hamstrings"]', 'legs', 'machine'],
  ['Leg Extension', 'quads', '[]', 'legs', 'machine'],
  ['Bulgarian Split Squat', 'quads', '["glutes","hamstrings"]', 'legs', 'dumbbell'],
  ['Walking Lunge', 'quads', '["glutes"]', 'legs', 'dumbbell'],
  ['Step-up', 'quads', '["glutes"]', 'legs', 'dumbbell'],
  // Legs — Posterior
  ['Romanian Deadlift', 'hamstrings', '["glutes","back"]', 'legs', 'barbell'],
  ['Leg Curl', 'hamstrings', '[]', 'legs', 'machine'],
  ['Hip Thrust', 'glutes', '["hamstrings"]', 'legs', 'barbell'],
  ['Good Morning', 'hamstrings', '["back","glutes"]', 'legs', 'barbell'],
  // Calves / Core
  ['Standing Calf Raise', 'calves', '[]', 'legs', 'machine'],
  ['Seated Calf Raise', 'calves', '[]', 'legs', 'machine'],
  ['Plank', 'core', '[]', 'core', 'bodyweight'],
  ['Crunch', 'core', '[]', 'core', 'bodyweight'],
  ['Cable Crunch', 'core', '[]', 'core', 'cable'],
  ['Russian Twist', 'core', '[]', 'core', 'bodyweight'],
  ['Hanging Leg Raise', 'core', '[]', 'core', 'bodyweight'],
  ['Ab Wheel Rollout', 'core', '[]', 'core', 'bodyweight'],
  ['Dead Bug', 'core', '[]', 'core', 'bodyweight'],
  // Cardio machines (also usable as duration activities)
  ['Treadmill Run', 'cardio', '[]', 'cardio', 'machine'],
  ['Jump Rope', 'cardio', '[]', 'cardio', 'bodyweight'],
  ['Rowing Machine', 'cardio', '["back"]', 'cardio', 'machine'],
  ['Cycling', 'cardio', '[]', 'cardio', 'machine'],
];

const ACTIVITY_TYPES = [
  { id: 'strength', label: 'Strength training' },
  { id: 'treadmill', label: 'Treadmill' },
  { id: 'cycling', label: 'Cycling' },
  { id: 'rowing', label: 'Rowing' },
  { id: 'jump_rope', label: 'Jump rope' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'walking', label: 'Walking' },
  { id: 'hiking', label: 'Hiking' },
  { id: 'stair_climbing', label: 'Stair climbing' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'basketball', label: 'Basketball' },
  { id: 'soccer', label: 'Soccer' },
  { id: 'yoga', label: 'Yoga' },
  { id: 'boxing', label: 'Boxing' },
  { id: 'other', label: 'Other' },
];

const VALID_MUSCLES = new Set([
  'chest', 'shoulders', 'triceps', 'back', 'biceps', 'forearms',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'cardio', 'other',
]);

const VALID_MOVEMENT = new Set(['push', 'pull', 'legs', 'core', 'cardio', 'other']);

const ACTIVITY_IDS = new Set(ACTIVITY_TYPES.map(a => a.id));

module.exports = {
  GYM_EXERCISES,
  ACTIVITY_TYPES,
  ACTIVITY_IDS,
  VALID_MUSCLES,
  VALID_MOVEMENT,
};
