// Plain-English explanations for the rows in "Where it goes", shown when a row is opened.
// Keyed by the row's plain name (from lib/spending.js); patterns cover filing labels we
// don't rename. The company's own description from its 10-K is shown alongside when we have it.

const BY_NAME = {
  'Making & delivering what they sell':
    'The direct cost of what it sold: materials, factories and shipping for products; data centers, content or the staff who deliver it for services. What goes in here varies a lot from company to company.',
  'Research & development': 'Building new products and improving existing ones. Mostly pay for engineers and scientists, plus labs, equipment and computing.',
  'Sales, marketing & overhead': 'Selling and running the company: salespeople and commissions, advertising, and head-office staff such as executives, finance, legal and HR.',
  'Sales & marketing': 'Winning customers: salespeople and their commissions, advertising and promotions.',
  'Running the company (overhead)': 'Head-office costs: executives, finance, legal, HR and IT, plus legal settlements and outside professional fees.',
  'Restructuring (layoffs, closures)': 'One-off costs of reorganizing: severance for laid-off staff, closing offices, stores or factories, and cancelling contracts.',
  'Smaller costs': 'Several smaller cost lines from the filing, combined into one row.',
  'Other costs': 'Operating costs the filing groups together as "other".',
  'Wear and tear on equipment': 'Depreciation and amortization: the cost of buildings, machines and other long-lived assets, spread over the years they are used. No cash leaves this year.',
  'Employee pay & benefits': 'Salaries, bonuses, stock awards, health care and retirement benefits for employees.',
  'Technology & communications': 'Computers, software, networks and data processing.',
  'Buying research projects from other companies': 'Research it bought from other companies, often drug candidates, before they became finished products. The price is counted as a cost right away.',
  'Set aside for loans that may not be repaid': 'Money a lender sets aside for loans and credit card balances it expects won\'t be paid back.',
  'Consultants & contractors': 'Outside lawyers, consultants, auditors and contractors.',
  'Cost of past acquisitions (amortization)': 'Part of the price paid for companies it bought (for patents, technology and customer lists), spread over several years. No cash leaves this year.',
  'Warehouses & shipping': 'Running warehouses and fulfillment centers, packing and shipping orders, customer service and payment processing.',
  'Technology & infrastructure': 'Engineers, plus the servers, data centers and networks behind its websites and cloud services.',
  'Write-downs (assets worth less than expected)': 'Admitting that assets such as acquired businesses or equipment are worth less than recorded. An accounting loss, not cash spent.',
  'Offices & buildings': 'Rent, upkeep and depreciation for offices, branches and other buildings.',
  'Costs of running the business': 'All operating costs. The filing doesn\'t break them down further.',
  'Costs not itemized': 'The part of total costs the filing doesn\'t list on a separate line.',
  'Interest & other costs': 'Interest paid on debt, plus other items outside day-to-day business such as investment losses or currency swings.',
  'Extra from investments & interest': 'Money from outside the main business: interest on its cash, gains on investments and other income.',
  'Income taxes': 'Income taxes on this year\'s profit (federal, state and foreign) as booked in the accounts. The cash actually paid this year can differ.',
  'Kept as profit': 'What\'s left after all costs and taxes. It can be paid to shareholders, reinvested in the business or saved.',
  'Lost money': 'Costs and taxes were more than revenue. The gap is covered by savings or borrowing.',
};

const BY_PATTERN = [
  [/cost of (goods|products|revenues?|sales|subscriptions)|product delivery/i, BY_NAME['Making & delivering what they sell']],
  [/medical costs/i, 'Health care bills it paid for its members: doctors, hospitals and prescriptions.'],
  [/insurance losses|benefits paid|policyholder/i, 'Claims and benefits paid to the people and businesses it insures.'],
  [/litigation/i, 'Money set aside for lawsuits and legal settlements.'],
  [/brokerage|clearing|exchange fees|transaction/i, 'Fees paid to exchanges, clearing houses, card networks and others to process transactions.'],
  [/interest/i, BY_NAME['Interest & other costs']],
  [/amortization|intangible/i, BY_NAME['Cost of past acquisitions (amortization)']],
  [/credit losses/i, BY_NAME['Set aside for loans that may not be repaid']],
  [/taxes other than/i, 'Property, payroll and other taxes that aren\'t based on profit.'],
  [/professional services/i, BY_NAME['Consultants & contractors']],
  [/cloud|software|information technology/i, BY_NAME['Technology & communications']],
  [/separation/i, 'One-off costs of splitting off part of the company into a separate business.'],
  [/extinguishment of debt/i, 'A gain or loss from paying off debt early.'],
  [/investment gains|nonoperating|other income/i, 'Items outside day-to-day business, such as investment gains or losses and currency swings.'],
  [/^services$/i, 'The cost of delivering the services it sold.'],
  [/marketing, administration and research/i, 'Selling, running the company and research, reported as one line.'],
  [/other operating charges/i, 'Other one-off operating costs, such as impairments, restructuring or legal matters.'],
];

/** A short general explanation for a row, or null. */
export function explainRow(row) {
  if (BY_NAME[row.label]) return BY_NAME[row.label];
  const text = `${row.label} ${row.filingLabel ?? ''}`.trim();
  for (const [re, explanation] of BY_PATTERN) if (re.test(text)) return explanation;
  return null;
}
