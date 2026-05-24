// Re-export the existing implementation. Logic lives in /staff/EmployeesPage
// for now — moving it would require touching every modal it owns. The shared
// component is consumed by both the old /staff route (legacy redirect target)
// and the new /people/employees route.
export { EmployeesPage } from '../staff/EmployeesPage';
