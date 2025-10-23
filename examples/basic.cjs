const lib = require('../dist');
const { getSchema, dataFormat } = lib;

/*
const dataset = [
  { name: "Alice", age: "32", score: "5.5", email: "work@andyball.info", date : "31/12/2020" },
  { name: "Bob",   age: "23", score: "4.2", email: "work@andyball.info", date : "31/12/2020" },
  { name: "Chan",  age: "12",    score: "3.9", email: "work@andyball.info", date : "31/12/2020" }
];
*/


const dataset = [
  {
    "company": "Acme Corp",
    "revenue": "$1,234,567.89",
    "growth": "12.5%",
    "employees": "250",
    "active": "true",
    "email": "work@andyball.info",
    "date": "31/12/2020"
  },
  {
    "company": "Globex Ltd",
    "revenue": "$987,654.00",
    "growth": "8.2%",
    "employees": "180",
    "active": "false",
    "email": "work@andyball.info",
    "date": "31/12/2020"
  },
  {
    "company": "Initech",
    "revenue": "$2,345,000.50",
    "growth": "15.0%",
    "employees": "320",
    "active": "true",
    "email": "work@andyball.info",
    "date": "31/12/2020"
  },
  {
    "company": "Umbrella Inc",
    "revenue": "$750,000",
    "growth": "5%",
    "employees": "",
    "active": "true",
    "email": "work@andyball.info",
    "date": "31/12/2020"
  }
]


console.log('Schema:', getSchema(dataset));
console.log(dataFormat(dataset));


