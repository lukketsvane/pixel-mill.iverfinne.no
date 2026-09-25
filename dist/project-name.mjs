export const hasProjectName=name=>typeof name==='string'&&!!name.trim()&&!/^untitled$/i.test(name.trim());
export function requireProjectName(name){if(!hasProjectName(name))throw Error('Give the project a name before saving.');return name.trim()}
