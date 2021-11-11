export const greeter = (person: string): string => {
  return `Hello, ${person}!`;
};

function testGreeter() {
  const user = "hbsnow";
  Logger.log(greeter(user));
}