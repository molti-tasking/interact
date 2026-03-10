import { useConfiguratorStore } from "@/stores/useFormConfiguratorStore";
import { DynamicFormRenderer } from "../DynamicFormRenderer";
import { ErrorBoundary } from "../ErrorBoundary";

export const ConfiguratorForm = () => {
  const store = useConfiguratorStore();

  // Check if configurator form has fields
  if (!store.configuratorFormSchema?.fields?.length) {
    return null;
  }

  const onChangeForm = (data: Record<string, unknown>) => {
    console.log(data);
  };

  return (
    <div>
      <ErrorBoundary boundaryName="configurator-form">
        <DynamicFormRenderer
          schema={store.configuratorFormSchema}
          defaultValues={store.configuratorFormValues}
          onChange={onChangeForm}
        />
      </ErrorBoundary>
      <p>THIS FORM IS TO TECHNICAL, MAKE IT LOOK NICE</p>
      <p>
        Small clouds that represent different aspects: If you do not like it you
        can kick it out.
      </p>
      <p>have all suggestions and cluster them bottom up to ask about themes</p>
      <p>Based on what has been suggested in a query </p>
      {/* <pre>{JSON.stringify(store.configuratorFormValues, null, 2)}</pre> */}
    </div>
  );
};
