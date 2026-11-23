import { AlignmentPackSchema, type AlignmentGraph } from '../lib/alignment-packs.js';

// Invented diagrams for the layout scorecard. Each one stresses a shape that real design docs produce.

type Spec = {
  // [id, parent container id or '' for the top level, label]; an element listed as a parent becomes a container.
  elements: [string, string, string][];
  // [from, to, label]
  connections: [string, string, string][];
};

function design({ elements, connections }: Spec): AlignmentGraph {
  const containers = new Set(elements.map(([, parent]) => parent).filter(Boolean));
  const groupId = (id: string) => `design:container:${id}`;
  const label = new Map(elements.map(([id, , text]) => [id, text]));
  return AlignmentPackSchema.parse({
    packVersion: 'layout-fixture@v1', source: { map: { id: 'layout-fixture', version: 'v1' } },
    viewState: { globalDepth: 1, expandedGroups: [], semanticZoom: 'business' },
    graph: {
    groups: [
      { id: 'design:root', label: 'Invented system', summary: 'Synthetic layout fixture' },
      ...[...containers].map(id => {
        const parent = elements.find(([element]) => element === id)?.[1];
        return { id: groupId(id), ownerNodeId: id, parentGroupId: parent ? groupId(parent) : 'design:root', label: label.get(id), summary: label.get(id) };
      }),
    ],
    nodes: elements.map(([id, parent, text]) => ({
      id, label: text, summary: text, elementKind: 'component',
      groupId: containers.has(id) ? groupId(id) : parent ? groupId(parent) : 'design:root',
    })),
    edges: connections.map(([from, to, text], index) => ({
      id: `c${index}`, fromNodeId: from, toNodeId: to, label: text, summary: text, relationship: 'design', direction: 'one-way',
    })),
    aggregateEdges: [],
    },
  }).graph;
}

const chain = (ids: string[]): [string, string, string][] => ids.slice(1).map((id, index) => [ids[index], id, `Hands step ${index + 1} to the next stage`]);

// Shaped like a mid-sized design doc: six top-level elements, three of them containers with
// five to eight children, and many connections that cross container walls.
const crossGroups = design({
  elements: [
    ['shoppers', '', 'Shoppers'],
    ['store', '', 'Web store'],
    ['catalog', 'store', 'Catalog page'], ['basket', 'store', 'Basket'], ['checkout', 'store', 'Checkout form'], ['tracker', 'store', 'Order tracker'], ['reviews', 'store', 'Review widget'],
    ['courier', '', 'Courier'],
    ['backend', '', 'Order backend'],
    ['desk', 'backend', 'Order desk'], ['pricing', 'backend', 'Pricing'], ['reserve', 'backend', 'Stock reserve'], ['charge', 'backend', 'Card charger'],
    ['planner', 'backend', 'Delivery planner'], ['refunds', 'backend', 'Refund desk'], ['notifier', 'backend', 'Notifier'], ['fraud', 'backend', 'Fraud screen'],
    ['warehouse', '', 'Warehouse records'],
    ['products', 'warehouse', 'Products'], ['orders', 'warehouse', 'Orders'], ['levels', 'warehouse', 'Stock levels'], ['shipments', 'warehouse', 'Shipments'], ['payments', 'warehouse', 'Payments'],
    ['bank', '', 'Card bank'],
  ],
  connections: [
    ['shoppers', 'catalog', 'Browse products'], ['catalog', 'basket', 'Add an item'], ['basket', 'checkout', 'Proceed to pay'],
    ['checkout', 'desk', 'Place the order'], ['desk', 'pricing', 'Price the basket'], ['pricing', 'products', 'Read list prices'],
    ['desk', 'reserve', 'Reserve units'], ['reserve', 'levels', 'Lower the counts'], ['desk', 'fraud', 'Screen the order'],
    ['desk', 'charge', 'Charge the card'], ['charge', 'bank', 'Ask for authorisation'], ['charge', 'payments', 'Record the charge'],
    ['desk', 'orders', 'Save the order'], ['desk', 'planner', 'Plan the delivery'], ['planner', 'shipments', 'Book a slot'],
    ['courier', 'planner', 'Accept a pickup'], ['notifier', 'tracker', 'Push status updates'], ['tracker', 'orders', 'Poll the status'],
    ['reviews', 'products', 'Attach a rating'], ['refunds', 'charge', 'Reverse the charge'], ['tracker', 'refunds', 'Ask for a refund'],
    ['planner', 'notifier', 'Announce dispatch'], ['catalog', 'levels', 'Show availability'],
  ],
});

// One top-level hub that every container talks to, plus links inside and between the containers.
const hubEverywhere = design({
  elements: [
    ['bus', '', 'Event bus'], ['airline', '', 'Airline systems'], ['security', '', 'Security office'],
    ['checkin', '', 'Check-in'],
    ['kiosk', 'checkin', 'Kiosk'], ['dropdesk', 'checkin', 'Bag drop desk'], ['tagger', 'checkin', 'Tag printer'], ['scale', 'checkin', 'Bag scale'],
    ['sorting', '', 'Baggage sorting'],
    ['belt', 'sorting', 'Belt controller'], ['scanner', 'sorting', 'X-ray scanner'], ['chutes', 'sorting', 'Chute router'], ['reject', 'sorting', 'Reject lane'],
    ['loading', '', 'Aircraft loading'],
    ['carts', 'loading', 'Cart tracker'], ['crew', 'loading', 'Ramp crew app'], ['hold', 'loading', 'Hold planner'],
    ['arrivals', '', 'Arrivals hall'],
    ['carousel', 'arrivals', 'Carousel display'], ['lost', 'arrivals', 'Lost bag desk'], ['texts', 'arrivals', 'Passenger texts'],
  ],
  connections: [
    ['airline', 'kiosk', 'Sends the booking'], ['kiosk', 'dropdesk', 'Hands over the bag'], ['dropdesk', 'scale', 'Weighs the bag'], ['dropdesk', 'tagger', 'Prints a tag'],
    ['dropdesk', 'bus', 'Announces a new bag'], ['bus', 'belt', 'Starts the belt'], ['belt', 'scanner', 'Feeds the scanner'], ['scanner', 'bus', 'Publishes the scan result'],
    ['scanner', 'reject', 'Diverts a flagged bag'], ['reject', 'security', 'Calls an officer'], ['bus', 'chutes', 'Assigns a chute'], ['chutes', 'carts', 'Drops into a cart'],
    ['bus', 'carts', 'Tells which flight'], ['carts', 'crew', 'Shows the load list'], ['crew', 'bus', 'Confirms the bag is loaded'], ['airline', 'hold', 'Sends the seat map'],
    ['hold', 'crew', 'Plans the hold'], ['bus', 'hold', 'Updates the bag count'], ['bus', 'carousel', 'Lists arriving bags'], ['bus', 'texts', 'Triggers a message'],
    ['lost', 'bus', 'Looks up a bag'], ['carousel', 'lost', 'Reports a missing bag'], ['texts', 'airline', 'Reads the contact details'],
  ],
});

// Two containers nested three deep with many links running between their inner cards.
const deepManyToMany = design({
  elements: [
    ['designer', '', 'Level designer'], ['files', '', 'Project files'],
    ['editor', '', 'Editor'],
    ['scene', 'editor', 'Scene tools'], ['terrain', 'scene', 'Terrain brush'], ['props', 'scene', 'Prop placer'], ['lights', 'scene', 'Light baker'],
    ['logic', 'editor', 'Script tools'], ['graph', 'logic', 'Logic graph'], ['stepper', 'logic', 'Step debugger'],
    ['assets', 'editor', 'Asset browser'],
    ['runtime', '', 'Game runtime'],
    ['sim', 'runtime', 'Simulation'], ['physics', 'sim', 'Physics'], ['agents', 'sim', 'Agent brains'], ['clock', 'sim', 'Tick clock'],
    ['render', 'runtime', 'Renderer'], ['meshes', 'render', 'Mesh cache'], ['shadows', 'render', 'Shadow pass'], ['post', 'render', 'Post effects'],
    ['loader', 'runtime', 'Content loader'],
  ],
  connections: [
    ['designer', 'terrain', 'Sculpts the ground'], ['designer', 'graph', 'Wires the logic'], ['terrain', 'props', 'Gives the ground height'],
    ['terrain', 'physics', 'Sends collision shapes'], ['terrain', 'meshes', 'Streams terrain tiles'], ['props', 'physics', 'Registers bodies'],
    ['props', 'meshes', 'Adds prop models'], ['props', 'agents', 'Marks cover spots'], ['lights', 'shadows', 'Bakes light maps'],
    ['lights', 'post', 'Sets the exposure'], ['graph', 'agents', 'Compiles behaviours'], ['graph', 'clock', 'Schedules events'],
    ['stepper', 'clock', 'Pauses the clock'], ['agents', 'stepper', 'Reports agent state'], ['clock', 'physics', 'Steps the world'],
    ['agents', 'physics', 'Casts rays'], ['meshes', 'shadows', 'Draws casters'], ['shadows', 'post', 'Hands the frame'],
    ['assets', 'loader', 'Requests a bundle'], ['loader', 'meshes', 'Uploads meshes'], ['assets', 'files', 'Indexes the files'],
    ['loader', 'files', 'Reads packed data'],
  ],
});

// One top-level gateway card that links into the children of four sibling containers, plus links between the containers.
const gatewayIntoGroups = design({
  elements: [
    ['portal', '', 'Library portal'],
    ['lending', '', 'Lending'], ['loans', 'lending', 'Loan desk'], ['holds', 'lending', 'Hold queue'], ['renewals', 'lending', 'Renewals'],
    ['catalogue', '', 'Catalogue'], ['search', 'catalogue', 'Search index'], ['records', 'catalogue', 'Title records'], ['covers', 'catalogue', 'Cover images'],
    ['members', '', 'Members'], ['signup', 'members', 'Sign-up form'], ['cards', 'members', 'Card register'], ['fines', 'members', 'Fines ledger'],
    ['events', '', 'Events'], ['calendar', 'events', 'Event calendar'], ['rooms', 'events', 'Room booker'], ['reminders', 'events', 'Reminder mailer'],
  ],
  connections: [
    ['portal', 'loans', 'Borrows a title'], ['portal', 'holds', 'Places a hold'], ['portal', 'search', 'Runs a search'], ['portal', 'signup', 'Joins the library'],
    ['portal', 'cards', 'Shows the card'], ['portal', 'calendar', 'Lists events'], ['portal', 'rooms', 'Books a room'],
    ['loans', 'renewals', 'Extends a loan'], ['search', 'records', 'Reads a record'], ['records', 'covers', 'Fetches the cover'], ['signup', 'cards', 'Issues a card'],
    ['calendar', 'reminders', 'Schedules a reminder'], ['loans', 'records', 'Checks the copy'], ['holds', 'records', 'Finds a copy'],
    ['renewals', 'fines', 'Charges a late fee'], ['loans', 'cards', 'Checks the card'], ['rooms', 'cards', 'Checks the member'], ['reminders', 'cards', 'Reads the contact'],
  ],
});

// Four sibling containers of four to six cards each and no hub: links run inside each container and between them.
const groupsOnly = design({
  elements: [
    ['kitchen', '', 'Kitchen'], ['orders', 'kitchen', 'Order rail'], ['prep', 'kitchen', 'Prep station'], ['grill', 'kitchen', 'Grill line'],
    ['plating', 'kitchen', 'Plating pass'], ['dishes', 'kitchen', 'Dish washer'],
    ['pantry', '', 'Pantry'], ['shelves', 'pantry', 'Dry shelves'], ['fridge', 'pantry', 'Walk-in fridge'], ['counts', 'pantry', 'Stock counts'], ['waste', 'pantry', 'Waste log'],
    ['floor', '', 'Dining floor'], ['host', 'floor', 'Host stand'], ['tables', 'floor', 'Table map'], ['waiters', 'floor', 'Waiter tablets'],
    ['bills', 'floor', 'Bill printer'], ['tips', 'floor', 'Tip pool'], ['feedback', 'floor', 'Feedback cards'],
    ['office', '', 'Back office'], ['rota', 'office', 'Staff rota'], ['buying', 'office', 'Supplier orders'], ['books', 'office', 'Account books'], ['payroll', 'office', 'Payroll'],
  ],
  connections: [
    ['host', 'tables', 'Seats a party'], ['tables', 'waiters', 'Assigns a table'], ['waiters', 'orders', 'Sends a ticket'], ['orders', 'prep', 'Calls the prep'],
    ['prep', 'grill', 'Passes the meat'], ['grill', 'plating', 'Hands the dish'], ['plating', 'waiters', 'Rings for pickup'], ['waiters', 'bills', 'Prints the bill'],
    ['bills', 'tips', 'Adds the tip'], ['bills', 'books', 'Posts the takings'], ['prep', 'fridge', 'Takes ingredients'], ['prep', 'shelves', 'Takes dry goods'],
    ['fridge', 'counts', 'Updates the count'], ['shelves', 'counts', 'Updates the count'], ['dishes', 'waste', 'Logs breakage'], ['counts', 'buying', 'Flags low stock'],
    ['buying', 'books', 'Records the invoice'], ['rota', 'payroll', 'Sends the hours'], ['tips', 'payroll', 'Shares the tips'], ['feedback', 'rota', 'Praises a waiter'],
  ],
});

export const layoutFixtures: Record<string, AlignmentGraph> = {
  'single card': design({ elements: [['only', '', 'Lone service']], connections: [] }),
  'long chain': design({
    elements: Array.from({ length: 10 }, (_, index) => [`s${index}`, '', `Stage ${index + 1}`]),
    connections: chain(Array.from({ length: 10 }, (_, index) => `s${index}`)),
  }),
  'fan in and out': design({
    elements: [['hub', '', 'Dispatcher'], ['sink', '', 'Collector'], ...Array.from({ length: 6 }, (_, index): [string, string, string] => [`w${index}`, '', `Worker ${index + 1}`])],
    connections: Array.from({ length: 6 }, (_, index): [string, string, string][] => [['hub', `w${index}`, 'Assigns a job'], [`w${index}`, 'sink', 'Reports the result']]).flat(),
  }),
  'deep nesting': design({
    elements: [
      ['outer', '', 'Outer system'], ['middle', 'outer', 'Middle module'], ['inner', 'middle', 'Inner unit'],
      ['a', 'inner', 'Parser'], ['b', 'inner', 'Checker'], ['c', 'middle', 'Planner'], ['d', 'outer', 'Runner'],
      ['user', '', 'Operator'], ['disk', '', 'Disk store'],
    ],
    connections: [['user', 'a', 'Submits input'], ['a', 'b', 'Passes the tree'], ['b', 'c', 'Hands a valid tree'], ['c', 'd', 'Sends the plan'], ['d', 'disk', 'Writes output'], ['b', 'disk', 'Reads rules']],
  }),
  'long labels': design({
    elements: [['a', '', 'Sender'], ['b', '', 'Receiver'], ['c', '', 'Auditor'], ['d', '', 'Archive']],
    connections: [
      ['a', 'b', 'Sends a signed batch of requests every few seconds while the queue is not empty'],
      ['b', 'c', 'Reports every rejected request with the reason and the original payload attached'],
      ['a', 'c', 'Copies the audit trail for compliance review at the end of each working day'],
      ['c', 'd', 'Moves reviewed audit entries into cold storage after thirty days'],
    ],
  }),
  'cross groups': crossGroups,
  'hub everywhere': hubEverywhere,
  'deep many to many': deepManyToMany,
  'gateway into groups': gatewayIntoGroups,
  'groups only': groupsOnly,
};

// Graphs far denser than a design doc, for the router's limits: stars wider than one card side holds, a complete
// graph, and a seeded random graph. Not part of the scorecard.
const star = (leaves: number) => design({
  elements: [['hub', '', 'Hub'], ...Array.from({ length: leaves }, (_, index): [string, string, string] => [`leaf${index}`, '', `Leaf ${index}`])],
  connections: Array.from({ length: leaves }, (_, index): [string, string, string] => ['hub', `leaf${index}`, `Sends batch ${index}`]),
});
const complete = (size: number) => design({
  elements: Array.from({ length: size }, (_, index): [string, string, string] => [`k${index}`, '', `Peer ${index}`]),
  connections: Array.from({ length: size }, (_, from) => Array.from({ length: size - from - 1 }, (_, offset): [string, string, string] => [`k${from}`, `k${from + offset + 1}`, `Syncs ${from}-${from + offset + 1}`])).flat(),
});
const random = (size: number, links: number) => {
  let seed = 7;
  const next = () => (seed = (seed * 48_271) % 2_147_483_647) % size;
  const connections: [string, string, string][] = [];
  for (let index = 0; index < links; index++) {
    const from = next(), to = next();
    if (from !== to) connections.push([`r${from}`, `r${to}`, `Calls ${index}`]);
  }
  return design({ elements: Array.from({ length: size }, (_, index): [string, string, string] => [`r${index}`, '', `Service ${index}`]), connections });
};

export const stressGraphs: Record<string, AlignmentGraph> = {
  star10: star(10), star12: star(12), star24: star(24), star40: star(40), K12: complete(12), rand40x60: random(40, 60),
};
